import { type World, type EntityId } from '../world';
import {
  positions,
  renderables,
  gridPositions,
  buildModes,
  BUILDABLES,
  GRID_CELL_SIZE,
  BUILDING_MARGIN,
  gridToWorld,
  rackSlots,
  rackLoads,
  machines,
  installedIns,
  powereds,
  installTasks,
  workloads,
  serverCapacities,
  utilizations,
  powerCapacities,
  coolingCapacities,
  openRackPanels,
  rackScrolls,
  dragStates,
  rejectedDrops,
  wallets,
  shopOpens,
  inventories,
} from '../components';
import {
  RACK_SLOT_CAPACITY,
  MACHINE_TIERS,
  TRAIT_KEYS,
  TRAIT_LABELS,
  TRAIT_UNITS,
  WORKLOAD_ARCHETYPES,
  POWER_COST_PER_KW_SECOND,
  type Traits,
  type PurchasableId,
  type MachineTierId,
} from '../game-data';
import { type Renderer } from '../../rendering';
import { type Camera } from '../../camera';
import { type InputState } from '../../input';
import { getRoomRect, getNextRoomTier } from '../room';
import { type GridBounds } from '../pathfinding';
import { SHOP_RECT, CORRIDOR_RECT, SHOP_DOOR } from '../world-map';
import { countOf } from '../inventory';
import { shopTab, shopCategories, shopCatalogForTab } from './shop';
import {
  getBuildPanelEntryRect,
  getRackPanelRect,
  getRackPanelContentRect,
  getRackPanelContentHeight,
  getRackPanelCloseButtonRect,
  getServerRowRect,
  getServerRowLabelY,
  getServerRowDrawY,
  getServerTraitBarRect,
  getPlacedChipRect,
  getTrayCardRect,
  getTrayTopY,
  RACK_PANEL_PADDING,
  getShopPanelRect,
  getShopCloseButtonRect,
  getShopTabRect,
  getShopRowRect,
  getShopBuyButtonRect,
  pointerInRect,
} from '../../ui/layout';
import { serversOn, trayWorkloadIds, placedWorkloadIds, maxRackScroll } from './rack-panel';
import { type System } from './system';

const PLAYER_RADIUS = 12;
const BUILDING_WALL_THICKNESS = 8;

function gridBoundsToPixelRect(bounds: GridBounds): { x: number; y: number; w: number; h: number } {
  const x = bounds.minGridX * GRID_CELL_SIZE;
  const y = bounds.minGridY * GRID_CELL_SIZE;
  const w = (bounds.maxGridX - bounds.minGridX + 1) * GRID_CELL_SIZE;
  const h = (bounds.maxGridY - bounds.minGridY + 1) * GRID_CELL_SIZE;
  return { x, y, w, h };
}

function drawBuilding(renderer: Renderer, world: World, facility: EntityId): void {
  const ctx = renderer.context;

  const roomBounds = getRoomRect(world, facility);
  const { x, y, w, h } = gridBoundsToPixelRect(roomBounds);

  // Floor
  ctx.fillStyle = '#1c1f22';
  ctx.fillRect(x, y, w, h);

  // Floor tiles (subtle grid, aligned to world grid origin and clipped to the floor)
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.strokeStyle = '#25292d';
  ctx.lineWidth = 1;
  for (let gx = x; gx <= x + w; gx += GRID_CELL_SIZE) {
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + h);
    ctx.stroke();
  }
  for (let gy = y; gy <= y + h; gy += GRID_CELL_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
    ctx.stroke();
  }

  ctx.restore();

  // Walls
  ctx.strokeStyle = '#4a4f57';
  ctx.lineWidth = BUILDING_WALL_THICKNESS;
  ctx.strokeRect(
    x - BUILDING_WALL_THICKNESS / 2,
    y - BUILDING_WALL_THICKNESS / 2,
    w + BUILDING_WALL_THICKNESS,
    h + BUILDING_WALL_THICKNESS,
  );

  // Inner highlight edge for depth
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  // Ghost outline of the next room tier, if one exists — makes the upgrade legible without a
  // menu (see .plans/facility-shop-inventory.md Step 2).
  const nextTier = getNextRoomTier(world, facility);
  if (nextTier) {
    const nextW = nextTier.gridWidth * GRID_CELL_SIZE;
    const nextH = nextTier.gridHeight * GRID_CELL_SIZE;
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(107, 114, 128, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, nextW, nextH);
    ctx.restore();
  }
}

// Shop building and the outdoor corridor connecting it to the room — the second walkable
// location the camera exists to make reachable (see .plans/facility-shop-inventory.md D2/D3).
function drawShopAndCorridor(renderer: Renderer): void {
  const ctx = renderer.context;

  const corridor = gridBoundsToPixelRect(CORRIDOR_RECT);
  ctx.fillStyle = '#1a1c1f';
  ctx.fillRect(corridor.x, corridor.y, corridor.w, corridor.h);

  const shop = gridBoundsToPixelRect(SHOP_RECT);
  ctx.fillStyle = '#1c1f22';
  ctx.fillRect(shop.x, shop.y, shop.w, shop.h);

  ctx.strokeStyle = '#4a4f57';
  ctx.lineWidth = BUILDING_WALL_THICKNESS;
  ctx.strokeRect(
    shop.x - BUILDING_WALL_THICKNESS / 2,
    shop.y - BUILDING_WALL_THICKNESS / 2,
    shop.w + BUILDING_WALL_THICKNESS,
    shop.h + BUILDING_WALL_THICKNESS,
  );
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 1;
  ctx.strokeRect(shop.x, shop.y, shop.w, shop.h);

  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#9aa0a6';
  ctx.fillText('SHOP', shop.x + shop.w / 2, shop.y + 16);
}

const RACK_PADDING = 4;

// 'partial'/'full' replace the old 'online-busy': full means every trait in ServerCapacity.free
// has hit zero (see capacity.ts), partial means some but not all capacity is used. A server can
// be 'online-idle' (nothing placed), 'partial', or 'full' without any single trait telling the
// whole story — that's the point of showing traits at all.
type SlotState = 'empty' | 'online-idle' | 'partial' | 'full' | 'offline';

const SLOT_SLAT_FILL: Record<SlotState, string> = {
  empty: '#22262b',
  'online-idle': '#2e343b',
  partial: '#2e343b',
  full: '#2e343b',
  offline: '#22262b',
};

const SLOT_LED_COLOR: Record<SlotState, string | null> = {
  empty: null,
  'online-idle': '#f7b731',
  partial: '#4dabf7',
  full: '#3ddc84',
  offline: '#e5484d',
};

function drawRack(renderer: Renderer, gridX: number, gridY: number, slots: SlotState[]): void {
  const ctx = renderer.context;
  const x = gridX * GRID_CELL_SIZE + RACK_PADDING;
  const y = gridY * GRID_CELL_SIZE + RACK_PADDING;
  const size = GRID_CELL_SIZE - RACK_PADDING * 2;

  // Cabinet frame with a slight shadow for depth
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(x + 2, y + 3, size, size);

  ctx.fillStyle = '#3a3f47';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = '#20242a';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, size, size);

  // Rack units (horizontal slats)
  const unitGap = 2;
  const unitHeight = (size - unitGap * (slots.length + 1)) / slots.length;
  for (let i = 0; i < slots.length; i++) {
    const unitY = y + unitGap + i * (unitHeight + unitGap);
    const state = slots[i];

    ctx.fillStyle = SLOT_SLAT_FILL[state];
    ctx.fillRect(x + unitGap, unitY, size - unitGap * 2, unitHeight);

    // Status LED per unit
    const ledColor = SLOT_LED_COLOR[state];
    if (ledColor) {
      ctx.fillStyle = ledColor;
      ctx.fillRect(x + size - unitGap - 5, unitY + unitHeight / 2 - 1.5, 3, 3);
    }

    // Faint vent lines
    ctx.strokeStyle = '#2f333a';
    ctx.lineWidth = 1;
    for (let vx = x + 8; vx < x + size - 10; vx += 4) {
      ctx.beginPath();
      ctx.moveTo(vx, unitY + 1);
      ctx.lineTo(vx, unitY + unitHeight - 1);
      ctx.stroke();
    }
  }
}

const RACK_LABEL_OVER_COLOR = '#e5484d';
const RACK_LABEL_COLOR = '#9aa0a6';

// Under-rack power/heat readout, read straight off RackLoad — visible from across the floor
// without opening anything. Colored against facility headroom so an over-drawing rack stands
// out. See .plans/workload-dispatch.md step 2.
function drawRackLoadLabel(
  renderer: Renderer,
  gridX: number,
  gridY: number,
  load: { powerKw: number; heatKw: number },
  facilityOverPower: boolean,
  facilityOverCooling: boolean,
): void {
  const ctx = renderer.context;
  const centerX = gridX * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;
  const labelY = gridY * GRID_CELL_SIZE + GRID_CELL_SIZE + 9;

  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = facilityOverPower ? RACK_LABEL_OVER_COLOR : RACK_LABEL_COLOR;
  ctx.fillText(`⚡ ${load.powerKw.toFixed(1)}kW`, centerX, labelY);
  ctx.fillStyle = facilityOverCooling ? RACK_LABEL_OVER_COLOR : RACK_LABEL_COLOR;
  ctx.fillText(`🔥 ${load.heatKw.toFixed(1)}kW`, centerX, labelY + 10);
}

function drawManager(renderer: Renderer, x: number, y: number): void {
  const ctx = renderer.context;

  // Soft shadow grounds the sprite on the floor
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.ellipse(x, y + PLAYER_RADIUS + 2, PLAYER_RADIUS * 0.8, PLAYER_RADIUS * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body (rounded rect torso)
  const bodyWidth = PLAYER_RADIUS * 1.5;
  const bodyHeight = PLAYER_RADIUS * 1.6;
  const bodyX = x - bodyWidth / 2;
  const bodyY = y - bodyHeight / 2 + 4;
  const radius = 5;

  ctx.fillStyle = '#2f6fb0';
  ctx.beginPath();
  ctx.moveTo(bodyX + radius, bodyY);
  ctx.arcTo(bodyX + bodyWidth, bodyY, bodyX + bodyWidth, bodyY + bodyHeight, radius);
  ctx.arcTo(bodyX + bodyWidth, bodyY + bodyHeight, bodyX, bodyY + bodyHeight, radius);
  ctx.arcTo(bodyX, bodyY + bodyHeight, bodyX, bodyY, radius);
  ctx.arcTo(bodyX, bodyY, bodyX + bodyWidth, bodyY, radius);
  ctx.closePath();
  ctx.fill();

  // High-vis stripe / clipboard accent so it reads as "manager"
  ctx.fillStyle = '#f7b731';
  ctx.fillRect(bodyX, bodyY + bodyHeight * 0.35, bodyWidth, 3);

  // Head
  const headRadius = PLAYER_RADIUS * 0.55;
  const headY = bodyY - headRadius + 2;
  ctx.fillStyle = '#e8b98a';
  ctx.beginPath();
  ctx.arc(x, headY, headRadius, 0, Math.PI * 2);
  ctx.fill();

  // Outline for contrast against dark floor
  ctx.strokeStyle = '#1c3f63';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bodyX + radius, bodyY);
  ctx.arcTo(bodyX + bodyWidth, bodyY, bodyX + bodyWidth, bodyY + bodyHeight, radius);
  ctx.arcTo(bodyX + bodyWidth, bodyY + bodyHeight, bodyX, bodyY + bodyHeight, radius);
  ctx.arcTo(bodyX, bodyY + bodyHeight, bodyX, bodyY, radius);
  ctx.arcTo(bodyX, bodyY, bodyX + bodyWidth, bodyY, radius);
  ctx.closePath();
  ctx.stroke();
}

// Points an arrow from the player toward the shop door when inventory is completely empty —
// makes "go buy something" legible without a menu (Step 6 polish, mitigating the "walking to
// the shop is dead time" trade-off).
function drawShopHint(renderer: Renderer, facility: EntityId, world: World, playerPosition: { x: number; y: number }): void {
  const inventory = world.getComponent(inventories, facility);
  const totalStock = inventory
    ? Object.values(inventory.counts).reduce((sum: number, count) => sum + (count ?? 0), 0)
    : 0;
  if (totalStock > 0) return;

  const doorCenter = gridToWorld(SHOP_DOOR.gridX, SHOP_DOOR.gridY);
  const dx = doorCenter.x - playerPosition.x;
  const dy = doorCenter.y - playerPosition.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 40) return;

  const angle = Math.atan2(dy, dx);
  const arrowDistance = 28;
  const arrowX = playerPosition.x + Math.cos(angle) * arrowDistance;
  const arrowY = playerPosition.y + Math.sin(angle) * arrowDistance - 20;

  const ctx = renderer.context;
  ctx.save();
  ctx.translate(arrowX, arrowY);
  ctx.rotate(angle);
  ctx.fillStyle = '#f7b731';
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-6, -5);
  ctx.lineTo(-6, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f7b731';
  ctx.fillText('SHOP', arrowX, arrowY - 12);
}

function drawPendingBorder(world: World, renderer: Renderer): void {
  let lowestDeadline = Infinity;
  for (const id of world.query(workloads)) {
    const workload = world.getComponent(workloads, id)!;
    if (workload.state !== 'accepted') continue;
    lowestDeadline = Math.min(lowestDeadline, workload.deadlineRemainingSeconds);
  }
  if (lowestDeadline === Infinity) return;

  const { width, height } = renderer;
  const ctx = renderer.context;
  const pulse = (Math.sin(performance.now() / 300) + 1) / 2;
  const escalated = lowestDeadline < 5;
  const color = escalated ? '229, 72, 77' : '247, 183, 49';

  ctx.save();
  ctx.strokeStyle = `rgba(${color}, ${0.4 + pulse * 0.5})`;
  ctx.lineWidth = 3;
  const inset = BUILDING_MARGIN + 2;
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  ctx.restore();
}

// Traits tooltip for a hovered machine build-panel entry — small floating box that follows the
// pointer, same compact "8c/32GB/1000GB" form used in the rack panel and shop. Only
// `machine-${MachineTierId}` buildables carry Traits (racks don't), so non-machine entries
// never trigger it.
function drawBuildPanelTooltip(renderer: Renderer, pointer: { x: number; y: number }, traits: Traits): void {
  const ctx = renderer.context;
  const text = formatDemands(traits);
  ctx.font = '11px sans-serif';
  const textWidth = ctx.measureText(text).width;
  const paddingX = 8;
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = 22;
  const x = pointer.x + 14;
  const y = pointer.y - boxHeight - 10;

  ctx.fillStyle = 'rgba(24, 27, 31, 0.97)';
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.strokeStyle = '#4a4f57';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, boxWidth, boxHeight);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = RACK_PANEL_TEXT;
  ctx.fillText(text, x + paddingX, y + boxHeight / 2);
}

function drawBuildPanel(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  facility: EntityId,
  pointer: { x: number; y: number } | null,
): void {
  const buildMode = world.getComponent(buildModes, controlled);

  renderer.context.font = '14px sans-serif';
  renderer.context.textAlign = 'center';
  renderer.context.textBaseline = 'middle';

  let hoveredTraits: Traits | null = null;

  BUILDABLES.forEach((buildable, index) => {
    const rect = getBuildPanelEntryRect(index, renderer.height);
    const isSelected = buildMode?.buildableId === buildable.id;
    const owned = countOf(world, facility, buildable.id as PurchasableId);
    const hasStock = owned > 0;

    renderer.context.fillStyle = isSelected ? '#4dabf7' : '#333';
    renderer.context.globalAlpha = hasStock ? 1 : 0.45;
    renderer.context.fillRect(rect.x, rect.y, rect.width, rect.height);
    renderer.context.strokeStyle = isSelected ? '#fff' : '#666';
    renderer.context.lineWidth = 2;
    renderer.context.strokeRect(rect.x, rect.y, rect.width, rect.height);

    renderer.context.fillStyle = '#fff';
    renderer.context.fillText(
      `${buildable.label}  x${owned}`,
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );

    renderer.context.textAlign = 'left';
    renderer.context.fillStyle = '#aaa';
    renderer.context.fillText(`${index + 1}`, rect.x + 4, rect.y + rect.height / 2);
    renderer.context.textAlign = 'center';

    renderer.context.globalAlpha = 1;

    if (pointer && buildable.id.startsWith('machine-') && pointerInRect(pointer, rect)) {
      const tierId = buildable.id.slice('machine-'.length) as MachineTierId;
      hoveredTraits = MACHINE_TIERS[tierId].traits;
    }
  });

  if (pointer && hoveredTraits) {
    drawBuildPanelTooltip(renderer, pointer, hoveredTraits);
  }
}

function drawInstallIndicator(world: World, renderer: Renderer, controlled: EntityId): void {
  const task = world.getComponent(installTasks, controlled);
  if (!task) return;

  const grid = world.getComponent(gridPositions, task.rackId);
  if (!grid) return;

  const center = gridToWorld(grid.gridX, grid.gridY);
  const ctx = renderer.context;

  if (!task.arrived) {
    const pulse = (Math.sin(performance.now() / 300) + 1) / 2;
    ctx.save();
    ctx.strokeStyle = `rgba(247, 183, 49, ${0.4 + pulse * 0.5})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(
      grid.gridX * GRID_CELL_SIZE + 2,
      grid.gridY * GRID_CELL_SIZE + 2,
      GRID_CELL_SIZE - 4,
      GRID_CELL_SIZE - 4,
    );
    ctx.restore();
    return;
  }

  const progress = 1 - task.secondsRemaining / task.totalSeconds;
  const radius = GRID_CELL_SIZE / 2 - 2;

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#3ddc84';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Compact "2c/4GB/50GB" form of a workload's demands, in TRAIT_KEYS order — used anywhere the
// player needs to see what a workload costs to run without opening a separate tooltip.
function formatDemands(demands: Traits): string {
  return TRAIT_KEYS.map((key) => `${demands[key]}${TRAIT_UNITS[key]}`).join('/');
}

const RACK_PANEL_TEXT = '#e6e8eb';
const RACK_PANEL_DIM = '#9aa0a6';
const RACK_PANEL_GREEN = '#3ddc84';
const RACK_PANEL_AMBER = '#f7b731';
const RACK_PANEL_RED = '#e5484d';

// Read-only as of step 7 — every server row and tray card draws but does not yet accept drops
// or drags; that lands in step 8. Viewing-mode panels draw identically to dispatching-mode
// ones (D4: "the panel draws every server's trait bars and placed-workload chips exactly as in
// dispatching mode"), so this function takes no mode-dependent branch for its own drawing —
// only the header text differs, to tell the player which mode they're in.
function drawRackPanel(world: World, renderer: Renderer, controlled: EntityId): void {
  const panel = world.getComponent(openRackPanels, controlled);
  if (!panel) return;
  // Dispatching-mode panels stay hidden while the player is still walking there — only
  // right-click's viewing mode is a true "peek from anywhere". Left-clicking a rack starts the
  // walk (see input.ts) but the panel itself doesn't appear until rack-panel.ts flips
  // `arrived` to true.
  if (panel.mode === 'dispatching' && !panel.arrived) return;

  const ctx = renderer.context;
  const { width: canvasWidth, height: canvasHeight } = renderer;

  const serverIds = serversOn(world, panel.rackId);
  const trayIds = trayWorkloadIds(world);
  const rect = getRackPanelRect(canvasWidth, canvasHeight, serverIds.length, trayIds.length);

  // Interactive == dispatching mode (D4: viewing renders identically but nothing responds to
  // drag). Used below to skip drawing hover/drag-only chrome in viewing mode, and by the drag
  // and rejection sections at the end of this function, which are meaningless while viewing.
  const interactive = panel.mode === 'dispatching';
  const drag = interactive ? world.getComponent(dragStates, controlled) : undefined;
  const rejection = interactive ? world.getComponent(rejectedDrops, controlled) : undefined;

  // Dim the floor behind the panel so it reads as a modal overlay.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = 'rgba(24, 27, 31, 0.97)';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = '#3a3f47';
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

  // Header. The "WALKING…" state never reaches this function (see the early return above —
  // dispatching-mode panels are hidden until arrived), so panel.mode === 'dispatching' here
  // always means arrived.
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = RACK_PANEL_TEXT;
  const headerY = rect.y + RACK_PANEL_PADDING + 8;
  const modeLabel = panel.mode === 'viewing' ? 'VIEWING (walk there to dispatch)' : 'DISPATCHING';
  ctx.fillText(`Rack — ${modeLabel}`, rect.x + 14, headerY);

  // Close button ("×").
  const closeRect = getRackPanelCloseButtonRect(canvasWidth, canvasHeight, serverIds.length, trayIds.length);
  ctx.strokeStyle = '#666';
  ctx.strokeRect(closeRect.x, closeRect.y, closeRect.width, closeRect.height);
  ctx.textAlign = 'center';
  ctx.fillStyle = RACK_PANEL_DIM;
  ctx.fillText('×', closeRect.x + closeRect.width / 2, closeRect.y + closeRect.height / 2);

  // Rack-wide total draw, right-aligned in the header (left of the close button) — RackLoad
  // already sums every online server's tier power/cooling plus their workloads' cooling
  // bonuses (capacity.ts), so no new aggregation is needed here.
  const rackLoad = world.getComponent(rackLoads, panel.rackId) ?? { powerKw: 0, heatKw: 0, serverCount: 0 };
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = RACK_PANEL_DIM;
  ctx.fillText(
    `⚡ ${rackLoad.powerKw.toFixed(1)}kW   🔥 ${rackLoad.heatKw.toFixed(1)}kW`,
    closeRect.x - 10,
    headerY,
  );

  // Server rows + tray both live in the scrollable content region: clip to it and translate up
  // by however far the player has scrolled, so every rect computed below (all laid out in
  // unscrolled content space by getServerRowRect/getTrayCardRect/getPlacedChipRect) ends up in
  // the right place on screen without needing scroll-awareness of its own. Restored before the
  // dragged card below, which must follow the raw cursor in screen space, not content space.
  const contentRect = getRackPanelContentRect(canvasWidth, canvasHeight, serverIds.length, trayIds.length);
  const contentHeight = getRackPanelContentHeight(serverIds.length, trayIds.length);
  const maxScroll = maxRackScroll(contentHeight, contentRect.height);
  const scrollOffsetPx = Math.min(world.getComponent(rackScrolls, controlled)?.offsetPx ?? 0, maxScroll);

  ctx.save();
  ctx.beginPath();
  ctx.rect(contentRect.x, contentRect.y, contentRect.width, contentRect.height);
  ctx.clip();
  ctx.translate(0, -scrollOffsetPx);

  // Server rows.
  serverIds.forEach((serverId, index) => {
    const row = getServerRowRect(index, canvasWidth, canvasHeight, serverIds.length, trayIds.length);
    const capacity = world.getComponent(serverCapacities, serverId);
    const machine = world.getComponent(machines, serverId)!;
    const online = world.getComponent(powereds, serverId)?.online ?? false;
    const tier = MACHINE_TIERS[machine.tierId];

    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(row.x, row.y, row.width, row.height);
    ctx.strokeStyle = '#2f333a';
    ctx.strokeRect(row.x, row.y, row.width, row.height);

    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = online ? RACK_PANEL_TEXT : RACK_PANEL_RED;
    ctx.fillText(online ? tier.label : `${tier.label} (offline)`, row.x + 6, getServerRowLabelY(row));

    // This server's own draw: tier baseline plus each placed workload's cooling bonus on top
    // (same per-workload heat math resource.ts's drawFor uses to decide brownouts) — lets the
    // player see why THIS box specifically is close to tripping a brownout, not just the
    // facility-wide total in the HUD.
    const rowWorkloadIds = placedWorkloadIds(world, serverId);
    const workloadCoolingKw = rowWorkloadIds.reduce(
      (sum, workloadId) =>
        sum + (WORKLOAD_ARCHETYPES[world.getComponent(workloads, workloadId)!.archetypeId].coolingBonusKw ?? 0),
      0,
    );
    // .plans/power-billing.md step 4 (optional): per-machine draw cost, so the tier trade-off
    // is a concrete number at the exact moment the player is deciding where to place work.
    const rowCoolingKw = tier.coolingKw + workloadCoolingKw;
    const rowCostPerSecond = (tier.powerKw + rowCoolingKw) * POWER_COST_PER_KW_SECOND;
    ctx.font = '9px sans-serif';
    ctx.fillStyle = RACK_PANEL_DIM;
    ctx.fillText(
      `⚡ ${tier.powerKw.toFixed(1)}kW   🔥 ${rowCoolingKw.toFixed(1)}kW   -$${rowCostPerSecond.toFixed(2)}/s`,
      row.x + 6,
      getServerRowDrawY(row),
    );

    // Pulse rejected trait bars red for a moment after a failed drop onto this server —
    // "flash the blocking trait bars red" (step 8).
    const rejectionHere = rejection?.serverId === serverId ? rejection : undefined;
    const flashPulse = rejectionHere ? (Math.sin(performance.now() / 90) + 1) / 2 : 0;

    // One bar per trait: label, then a thin usage bar beneath it.
    TRAIT_KEYS.forEach((key, traitIndex) => {
      const barRect = getServerTraitBarRect(index, traitIndex, canvasWidth, canvasHeight, serverIds.length, trayIds.length);
      const total = capacity?.total[key] ?? tier.traits[key];
      const free = capacity?.free[key] ?? tier.traits[key];
      const used = total - free;
      const fraction = total > 0 ? used / total : 0;
      const exhausted = free <= 0;
      const flashing = rejectionHere?.blocking.includes(key) ?? false;

      ctx.font = '9px sans-serif';
      ctx.fillStyle = flashing ? RACK_PANEL_RED : RACK_PANEL_DIM;
      ctx.fillText(`${TRAIT_LABELS[key]} ${used}/${total}`, barRect.x, barRect.y - 6);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(barRect.x, barRect.y, barRect.width, barRect.height);
      ctx.fillStyle = exhausted ? RACK_PANEL_RED : RACK_PANEL_GREEN;
      ctx.fillRect(barRect.x, barRect.y, barRect.width * Math.min(1, fraction), barRect.height);

      if (flashing) {
        ctx.strokeStyle = `rgba(229, 72, 77, ${0.5 + flashPulse * 0.5})`;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(barRect.x - 1, barRect.y - 9, barRect.width + 2, barRect.height + 10);
      }
    });

    // Placed-workload chips, top-right of the row. The one currently being dragged is skipped
    // here — it's drawn once, following the cursor, at the end of this function instead.
    const placedIds = placedWorkloadIds(world, serverId);
    placedIds.forEach((workloadId, chipIndex) => {
      if (drag && drag.workloadId === workloadId) return;

      const chip = getPlacedChipRect(index, chipIndex, canvasWidth, canvasHeight, serverIds.length, trayIds.length);
      const workload = world.getComponent(workloads, workloadId)!;
      const archetype = WORKLOAD_ARCHETYPES[workload.archetypeId];

      ctx.fillStyle = '#2e343b';
      ctx.fillRect(chip.x, chip.y, chip.width, chip.height);
      ctx.strokeStyle = interactive ? '#4dabf7' : '#555';
      ctx.strokeRect(chip.x, chip.y, chip.width, chip.height);
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = RACK_PANEL_TEXT;
      // Only render-farm/training archetypes carry a cooling bonus (web/batch are 0kW — see
      // WORKLOAD_ARCHETYPES); appending it lets the player see, per workload, what's adding to
      // this server's heat line above without opening a separate tooltip.
      const chipLabel =
        archetype.coolingBonusKw > 0 ? `${archetype.label} 🔥${archetype.coolingBonusKw.toFixed(1)}` : archetype.label;
      ctx.fillText(chipLabel, chip.x + 3, chip.y + chip.height / 2, chip.width - 6);
    });
  });

  // Tray: accepted-but-unplaced workloads. Header first, then one card per workload.
  const trayHeaderY =
    getTrayTopY(canvasWidth, canvasHeight, serverIds.length, trayIds.length) + 9;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = RACK_PANEL_DIM;
  ctx.fillText('TRAY — accepted, not yet placed', rect.x + 14, trayHeaderY);

  if (trayIds.length === 0) {
    ctx.font = '10px sans-serif';
    ctx.fillStyle = RACK_PANEL_DIM;
    ctx.fillText('(empty)', rect.x + 14, trayHeaderY + 16);
  } else {
    trayIds.forEach((workloadId, index) => {
      if (drag && drag.origin === 'tray' && drag.workloadId === workloadId) return;

      const card = getTrayCardRect(index, canvasWidth, canvasHeight, serverIds.length, trayIds.length);
      const workload = world.getComponent(workloads, workloadId)!;
      const archetype = WORKLOAD_ARCHETYPES[workload.archetypeId];
      const urgent = workload.deadlineRemainingSeconds < 10;

      ctx.fillStyle = '#2e343b';
      ctx.fillRect(card.x, card.y, card.width, card.height);
      ctx.strokeStyle = urgent ? RACK_PANEL_RED : '#4a4f57';
      ctx.strokeRect(card.x, card.y, card.width, card.height);

      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = RACK_PANEL_TEXT;
      ctx.fillText(archetype.label, card.x + 6, card.y + card.height * 0.24);

      ctx.font = '8px sans-serif';
      ctx.fillStyle = RACK_PANEL_DIM;
      ctx.fillText(formatDemands(workload.demands), card.x + 6, card.y + card.height * 0.55);

      ctx.font = '9px sans-serif';
      ctx.fillStyle = urgent ? RACK_PANEL_AMBER : RACK_PANEL_DIM;
      ctx.fillText(
        `${Math.max(0, Math.ceil(workload.deadlineRemainingSeconds))}s left`,
        card.x + 6,
        card.y + card.height * 0.84,
      );
    });
  }

  ctx.restore(); // end content clip/scroll — everything below draws in normal screen space

  // Scrollbar: a thin track down the content region's right edge with a thumb sized/positioned
  // to the visible fraction, same idea as a native scrollbar. Only drawn once there's actually
  // something to scroll — most racks (a handful of servers, an empty tray) never trigger it.
  if (maxScroll > 0) {
    const trackX = contentRect.x + contentRect.width - 4;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(trackX, contentRect.y, 3, contentRect.height);

    const thumbHeight = Math.max(20, (contentRect.height / contentHeight) * contentRect.height);
    const thumbY = contentRect.y + (scrollOffsetPx / maxScroll) * (contentRect.height - thumbHeight);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(trackX, thumbY, 3, thumbHeight);
  }

  // The dragged card itself, following the cursor, drawn last so it's always on top.
  if (drag) {
    const workload = world.getComponent(workloads, drag.workloadId);
    if (workload) {
      const archetype = WORKLOAD_ARCHETYPES[workload.archetypeId];
      const cardWidth = 120;
      const cardHeight = 30;
      const x = drag.pointer.x - cardWidth / 2;
      const y = drag.pointer.y - cardHeight / 2;

      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#3a4048';
      ctx.fillRect(x, y, cardWidth, cardHeight);
      ctx.strokeStyle = RACK_PANEL_GREEN;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, cardWidth, cardHeight);
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = RACK_PANEL_TEXT;
      ctx.fillText(archetype.label, x + cardWidth / 2, y + cardHeight * 0.35);

      ctx.font = '9px sans-serif';
      ctx.fillStyle = RACK_PANEL_DIM;
      ctx.fillText(formatDemands(workload.demands), x + cardWidth / 2, y + cardHeight * 0.7);
      ctx.restore();
    }
  }
}

const SHOP_TEXT = '#e6e8eb';
const SHOP_DIM = '#9aa0a6';
const SHOP_GREEN = '#3ddc84';

function drawShopPanel(world: World, renderer: Renderer, controlled: EntityId, facility: EntityId): void {
  if (!world.getComponent(shopOpens, controlled)) return;

  const ctx = renderer.context;
  const { width: canvasWidth, height: canvasHeight } = renderer;

  const categories = shopCategories();
  const rows = shopCatalogForTab(shopTab.current);
  const rect = getShopPanelRect(canvasWidth, canvasHeight, rows.length);
  const wallet = world.getComponent(wallets, facility);
  const money = wallet ? Math.floor(wallet.money) : 0;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = 'rgba(24, 27, 31, 0.97)';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeStyle = '#3a3f47';
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = SHOP_TEXT;
  ctx.fillText(`Shop — $${money}`, rect.x + 14, rect.y + RACK_PANEL_PADDING + 8);

  const closeRect = getShopCloseButtonRect(canvasWidth, canvasHeight, rows.length);
  ctx.strokeStyle = '#666';
  ctx.strokeRect(closeRect.x, closeRect.y, closeRect.width, closeRect.height);
  ctx.textAlign = 'center';
  ctx.fillStyle = SHOP_DIM;
  ctx.fillText('×', closeRect.x + closeRect.width / 2, closeRect.y + closeRect.height / 2);

  categories.forEach((category, tabIndex) => {
    const tabRect = getShopTabRect(tabIndex, categories.length, canvasWidth, canvasHeight, rows.length);
    const isActive = category === shopTab.current;
    ctx.fillStyle = isActive ? '#2f6fb0' : '#2a2e33';
    ctx.fillRect(tabRect.x, tabRect.y, tabRect.width, tabRect.height);
    ctx.strokeStyle = isActive ? '#4dabf7' : '#3a3f47';
    ctx.strokeRect(tabRect.x, tabRect.y, tabRect.width, tabRect.height);
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = SHOP_TEXT;
    ctx.fillText(category, tabRect.x + tabRect.width / 2, tabRect.y + tabRect.height / 2);
  });

  rows.forEach((purchasable, index) => {
    const row = getShopRowRect(index, canvasWidth, canvasHeight, rows.length);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(row.x, row.y, row.width, row.height);
    ctx.strokeStyle = '#2f333a';
    ctx.strokeRect(row.x, row.y, row.width, row.height);

    const owned = purchasable.kind === 'stock' ? countOf(world, facility, purchasable.id as PurchasableId) : null;
    const label = owned !== null ? `${purchasable.label}  x${owned}` : purchasable.label;

    // Machine purchasables carry Traits (game-data.ts's MachineTierDef) — show them under the
    // label so the player can compare CPU/RAM/storage across tiers before buying, the same
    // compact form as a workload's demands in the rack panel.
    const tierId = purchasable.id.startsWith('machine-') ? (purchasable.id.slice('machine-'.length) as MachineTierId) : null;
    const traits = tierId ? MACHINE_TIERS[tierId].traits : null;

    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = SHOP_TEXT;
    ctx.fillText(label, row.x + 8, row.y + row.height * (traits ? 0.32 : 0.5));

    if (traits) {
      ctx.font = '10px sans-serif';
      ctx.fillStyle = SHOP_DIM;
      ctx.fillText(formatDemands(traits), row.x + 8, row.y + row.height * 0.7);
    }

    const buyRect = getShopBuyButtonRect(index, canvasWidth, canvasHeight, rows.length);
    const affordable = money >= purchasable.cost;
    ctx.fillStyle = affordable ? '#2f6f4f' : '#3a3f47';
    ctx.globalAlpha = affordable ? 1 : 0.6;
    ctx.fillRect(buyRect.x, buyRect.y, buyRect.width, buyRect.height);
    ctx.strokeStyle = affordable ? SHOP_GREEN : '#666';
    ctx.strokeRect(buyRect.x, buyRect.y, buyRect.width, buyRect.height);
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = SHOP_TEXT;
    ctx.fillText(`$${purchasable.cost}`, buyRect.x + buyRect.width / 2, buyRect.y + buyRect.height / 2);
    ctx.globalAlpha = 1;
  });

  ctx.textAlign = 'left';
}

export function createRenderSystem(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  facility: EntityId,
  camera: Camera,
  input: InputState,
): System {
  return {
    update() {
      camera.applyTransform(renderer.context);

      drawBuilding(renderer, world, facility);
      drawShopAndCorridor(renderer);

      const machinesByRack = new Map<EntityId, EntityId[]>();
      for (const id of world.query(machines, installedIns)) {
        const installedIn = world.getComponent(installedIns, id)!;
        const bucket = machinesByRack.get(installedIn.rackId);
        if (bucket) {
          bucket.push(id);
        } else {
          machinesByRack.set(installedIn.rackId, [id]);
        }
      }

      for (const id of world.query(renderables, gridPositions)) {
        const renderable = world.getComponent(renderables, id)!;
        if (renderable.kind !== 'rack') continue;

        const grid = world.getComponent(gridPositions, id)!;
        const capacity = world.getComponent(rackSlots, id)?.capacity ?? RACK_SLOT_CAPACITY;
        const installedMachines = machinesByRack.get(id) ?? [];

        const slots: SlotState[] = new Array(capacity).fill('empty');
        for (const machineId of installedMachines) {
          const installedIn = world.getComponent(installedIns, machineId)!;
          const powered = world.getComponent(powereds, machineId);
          if (!powered?.online) {
            slots[installedIn.slotIndex] = 'offline';
            continue;
          }

          // Partial vs. full: any trait in ServerCapacity.free at zero means full — a server
          // can be maxed on CPU while still having free RAM/storage, which is exactly the
          // situation traits exist to surface. capacity.ts populates this every frame after
          // the first, so the `?? online-idle` fallback only ever applies momentarily.
          const capacityState = world.getComponent(serverCapacities, machineId);
          if (capacityState) {
            const anyTraitExhausted =
              capacityState.free.cpu <= 0 ||
              capacityState.free.ramGb <= 0 ||
              capacityState.free.storageGb <= 0;
            const anyTraitUsed =
              capacityState.free.cpu < capacityState.total.cpu ||
              capacityState.free.ramGb < capacityState.total.ramGb ||
              capacityState.free.storageGb < capacityState.total.storageGb;
            slots[installedIn.slotIndex] = anyTraitExhausted
              ? 'full'
              : anyTraitUsed
                ? 'partial'
                : 'online-idle';
          } else {
            slots[installedIn.slotIndex] = 'online-idle';
          }
        }

        drawRack(renderer, grid.gridX, grid.gridY, slots);

        const load = world.getComponent(rackLoads, id);
        if (load) {
          const powerCapacity = world.getComponent(powerCapacities, facility);
          const coolingCapacity = world.getComponent(coolingCapacities, facility);
          const utilization = world.getComponent(utilizations, facility);
          const facilityOverPower = Boolean(
            powerCapacity && utilization && utilization.powerDrawKw > powerCapacity.kw,
          );
          const facilityOverCooling = Boolean(
            coolingCapacity && utilization && utilization.coolingDrawKw > coolingCapacity.kw,
          );
          drawRackLoadLabel(renderer, grid.gridX, grid.gridY, load, facilityOverPower, facilityOverCooling);
        }
      }

      drawInstallIndicator(world, renderer, controlled);

      for (const id of world.query(renderables, positions)) {
        const renderable = world.getComponent(renderables, id)!;
        if (renderable.kind !== 'player-circle') continue;

        const position = world.getComponent(positions, id)!;
        drawManager(renderer, position.x, position.y);
        drawShopHint(renderer, facility, world, position);
      }

      camera.resetTransform(renderer.context);

      // Everything below is screen-space UI: HUD bar, build/rack panels, pending-deadline
      // border. Drawn outside the camera transform (see .plans/facility-shop-inventory.md D1).
      drawPendingBorder(world, renderer);

      // The rack panel and shop panel are both full-screen modals that replace the build panel
      // rather than drawing over/under it. Same priority order as input.ts's click chain: rack
      // panel first, then shop.
      if (world.getComponent(openRackPanels, controlled)) {
        drawRackPanel(world, renderer, controlled);
      } else if (world.getComponent(shopOpens, controlled)) {
        drawShopPanel(world, renderer, controlled, facility);
      } else {
        drawBuildPanel(world, renderer, controlled, facility, input.getPointerPosition());
      }
    },
  };
}
