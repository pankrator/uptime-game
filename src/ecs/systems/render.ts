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
  worldToGrid,
  rackSlots,
  rackLoads,
  machines,
  installedIns,
  powereds,
  maintenanceTasks,
  conditions,
  faileds,
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
  cycleLabel,
  temperatures,
  thermalTrips,
  coolingUnits,
  decommissionConfirms,
  floatingTexts,
  roomTiers,
} from '../components';
import {
  RACK_SLOT_CAPACITY,
  MACHINE_TIERS,
  TRAIT_KEYS,
  TRAIT_LABELS,
  TRAIT_UNITS,
  WORKLOAD_ARCHETYPES,
  POWER_COST_PER_KW_SECOND,
  AMBIENT_C,
  THROTTLE_C,
  TRIP_C,
  REPAIRABLE_WEAR_THRESHOLD,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  type Traits,
  type PurchasableId,
  type MachineTierId,
} from '../game-data';
import { repairCost } from '../wear';
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
  getTrayCardDropButtonRect,
  getTrayTopY,
  getServerRepairButtonRect,
  getServerDecommissionButtonRect,
  RACK_PANEL_PADDING,
  getShopPanelRect,
  getShopCloseButtonRect,
  getShopTabRect,
  getShopRowRect,
  getShopBuyButtonRect,
  pointerInRect,
} from '../../ui/layout';
import { serversOn, trayWorkloadIds, placedWorkloadIds, maxRackScroll } from './rack-panel';
import { FLOATING_TEXT_RISE_PX } from './effects';
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

// .plans/playtest-findings.md F8: everything outside the room/corridor/shop used to be an
// uncleared canvas — transparent over the page's #000 background, reading as a black void
// rather than "outdoors". A flat ground fill plus a sparse dot scatter (cheap, no images) gives
// it a texture without competing with the building art drawn on top of it. Drawn first, so
// drawBuilding/drawShopAndCorridor paint over it exactly like before.
const OUTDOOR_DOT_SEED_COLS = 40;
const OUTDOOR_DOT_SEED_ROWS = 27;

function drawOutdoors(renderer: Renderer): void {
  const ctx = renderer.context;
  ctx.fillStyle = '#14171a';
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  // Deterministic scatter (no Math.random — would repaint differently every frame) laid out on
  // a coarse grid with a per-cell jitter, so it reads as texture rather than an obvious repeat.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  const colGap = WORLD_WIDTH / OUTDOOR_DOT_SEED_COLS;
  const rowGap = WORLD_HEIGHT / OUTDOOR_DOT_SEED_ROWS;
  for (let row = 0; row < OUTDOOR_DOT_SEED_ROWS; row++) {
    for (let col = 0; col < OUTDOOR_DOT_SEED_COLS; col++) {
      const jitterX = ((row * 7 + col * 13) % 11) - 5;
      const jitterY = ((row * 5 + col * 17) % 9) - 4;
      const x = col * colGap + colGap / 2 + jitterX;
      const y = row * rowGap + rowGap / 2 + jitterY;
      ctx.fillRect(x, y, 2, 2);
    }
  }
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

// Blue (ambient/cool) -> amber (throttle band) -> red (tripped), interpolated linearly across
// the two sub-ranges. See .plans/thermal-and-cooling.md D8.
const HEAT_COOL_RGB: [number, number, number] = [61, 139, 220];
const HEAT_WARN_RGB: [number, number, number] = [247, 183, 49];
const HEAT_HOT_RGB: [number, number, number] = [229, 72, 77];

function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
  ];
}

function heatColor(celsius: number): [number, number, number] {
  if (celsius <= THROTTLE_C) {
    return lerpRgb(HEAT_COOL_RGB, HEAT_WARN_RGB, (celsius - AMBIENT_C) / (THROTTLE_C - AMBIENT_C));
  }
  return lerpRgb(HEAT_WARN_RGB, HEAT_HOT_RGB, (celsius - THROTTLE_C) / (TRIP_C - THROTTLE_C));
}

const HEAT_OVERLAY_MAX_ALPHA = 0.35;

// Per-cell heat wash, drawn before racks so the cabinet art sits on top of it — the interface to
// the thermal mechanic (D8): the player must be able to read "this corner is hot" from across
// the floor, not just from a rack's label. A soft radial glow rather than a hard-edged cell fill
// so racks near each other visibly blend into a hot patch. Racks at/below ambient draw nothing —
// there's no useful signal in "this rack is exactly as cool as the room."
function drawHeatOverlay(renderer: Renderer, world: World): void {
  const ctx = renderer.context;
  for (const rackId of world.query(rackSlots, gridPositions, temperatures)) {
    const grid = world.getComponent(gridPositions, rackId)!;
    const temperature = world.getComponent(temperatures, rackId)!;
    if (temperature.celsius <= AMBIENT_C) continue;

    const [r, g, b] = heatColor(temperature.celsius);
    const alpha =
      HEAT_OVERLAY_MAX_ALPHA *
      Math.min(1, (temperature.celsius - AMBIENT_C) / (TRIP_C - AMBIENT_C));
    const centerX = grid.gridX * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;
    const centerY = grid.gridY * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;
    const radius = GRID_CELL_SIZE * 1.4;

    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  }
}

const RACK_PADDING = 4;

// 'partial'/'full' replace the old 'online-busy': full means every trait in ServerCapacity.free
// has hit zero (see capacity.ts), partial means some but not all capacity is used. A server can
// be 'online-idle' (nothing placed), 'partial', or 'full' without any single trait telling the
// whole story — that's the point of showing traits at all.
// 'failed' is distinct from plain 'offline' (a brownout/thermal trip, both self-recovering) —
// see .plans/hardware-failure.md D7: a failed machine needs to be unmistakable at a glance,
// because unlike the other offline states it never comes back without the player walking over
// to repair it.
type SlotState = 'empty' | 'online-idle' | 'partial' | 'full' | 'offline' | 'failed';

const SLOT_SLAT_FILL: Record<SlotState, string> = {
  empty: '#22262b',
  'online-idle': '#2e343b',
  partial: '#2e343b',
  full: '#2e343b',
  offline: '#22262b',
  failed: '#3a2226',
};

const SLOT_LED_COLOR: Record<SlotState, string | null> = {
  empty: null,
  'online-idle': '#f7b731',
  partial: '#4dabf7',
  full: '#3ddc84',
  offline: '#e5484d',
  failed: '#e5484d',
};

// .plans/playtest-findings.md F8: a built-out facility used to be visually monotonous — every
// installed slat looked identical regardless of which tier it held. A thin left-edge accent per
// tier is additive (drawn on top of the existing slat fill/LED, never replacing either) so the
// carefully-tuned status visualization (SLOT_SLAT_FILL/SLOT_LED_COLOR) stays exactly as legible.
const TIER_ACCENT_COLOR: Record<MachineTierId, string> = {
  budget: '#6b7280',
  basic: '#4dabf7',
  dense: '#c77dff',
  storage: '#f7b731',
  memory: '#3ddc84',
};

function drawRack(
  renderer: Renderer,
  gridX: number,
  gridY: number,
  slots: SlotState[],
  tiers: (MachineTierId | null)[],
): void {
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

    // Tier accent stripe — only for an occupied slot (an empty slot has no tier to show).
    const tier = tiers[i];
    if (tier) {
      ctx.fillStyle = TIER_ACCENT_COLOR[tier];
      ctx.fillRect(x + unitGap, unitY, 3, unitHeight);
    }

    // Status LED per unit
    const ledColor = SLOT_LED_COLOR[state];
    if (ledColor) {
      ctx.fillStyle = ledColor;
      ctx.fillRect(x + size - unitGap - 5, unitY + unitHeight / 2 - 1.5, 3, 3);
    }

    // Failed slat gets a warning glyph too, not just the red LED (D7: "unmistakable at a
    // glance") — a pulsing ⚠ so it reads differently from a merely-offline (brownout/thermal)
    // slat, which shares the same red LED but never pulses.
    if (state === 'failed') {
      const pulse = (Math.sin(performance.now() / 220) + 1) / 2;
      ctx.font = `${Math.max(8, unitHeight - 2)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.6 + pulse * 0.4;
      ctx.fillStyle = '#e5484d';
      ctx.fillText('⚠', x + unitGap + 2, unitY + unitHeight / 2);
      ctx.globalAlpha = 1;
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
function temperatureColor(celsius: number): string {
  if (celsius >= TRIP_C) return RACK_LABEL_OVER_COLOR;
  if (celsius >= THROTTLE_C) return '#f7b731';
  return RACK_LABEL_COLOR;
}

// Same two thresholds as the rack panel's wear bar (RACK_PANEL_AMBER/RED below), so a rack that
// reads amber from across the floor still reads amber once you open it.
function rackWearColor(wear: number): string {
  if (wear > 0.7) return RACK_LABEL_OVER_COLOR;
  if (wear > 0.4) return '#f7b731';
  return RACK_LABEL_COLOR;
}

// Below this the wear readout is omitted rather than drawn in grey: a healthy floor should stay
// uncluttered, and wear under 40% is near-harmless anyway (failure chance is
// BASE_FAILURE_RATE * wear^3 — see wear.ts).
const RACK_LABEL_WEAR_THRESHOLD = 0.4;

// Worst wear among a rack's installed machines, or undefined if it holds none. Only the worst
// one reaches the floor label: the question from across the room is "does this rack need me?",
// and the rack panel already answers "what is each box at" per server.
function worstRackWear(world: World, machineIds: EntityId[]): number | undefined {
  let worst: number | undefined;
  for (const machineId of machineIds) {
    const condition = world.getComponent(conditions, machineId);
    if (!condition) continue;
    if (worst === undefined || condition.wear > worst) worst = condition.wear;
  }
  return worst;
}

function drawRackLoadLabel(
  renderer: Renderer,
  gridX: number,
  gridY: number,
  load: { powerKw: number; heatKw: number },
  facilityOverPower: boolean,
  facilityOverCooling: boolean,
  temperature: { celsius: number } | undefined,
  worstWear: number | undefined,
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

  // Temperature and worst wear SHARE the third line rather than stacking a fourth: the block is
  // already 29px deep under a 40px GRID_CELL_SIZE, so another row would overlap the label of a
  // rack placed directly below. Side by side is also the point — a hot rack wears its machines up
  // to HEAT_WEAR_MULTIPLIER_MAX faster, and the two numbers adjacent is how that link teaches
  // itself.
  const celsius = temperature?.celsius;
  const wear =
    worstWear !== undefined && worstWear > RACK_LABEL_WEAR_THRESHOLD ? worstWear : undefined;

  if (celsius !== undefined && wear !== undefined) {
    ctx.textAlign = 'right';
    ctx.fillStyle = temperatureColor(celsius);
    ctx.fillText(`${Math.round(celsius)}°C`, centerX - 3, labelY + 20);
    ctx.textAlign = 'left';
    ctx.fillStyle = rackWearColor(wear);
    ctx.fillText(`🔧${Math.round(wear * 100)}%`, centerX + 3, labelY + 20);
    ctx.textAlign = 'center';
  } else if (celsius !== undefined) {
    ctx.fillStyle = temperatureColor(celsius);
    ctx.fillText(`${Math.round(celsius)}°C`, centerX, labelY + 20);
  } else if (wear !== undefined) {
    ctx.fillStyle = rackWearColor(wear);
    ctx.fillText(`🔧${Math.round(wear * 100)}%`, centerX, labelY + 20);
  }
}

// Throttle/trip badge, drawn above a hot rack — the trip case reuses the same red the brownout
// path already uses elsewhere in this file, so "this rack is dark" reads the same regardless of
// cause. See .plans/thermal-and-cooling.md D8.
function drawThermalBadge(
  renderer: Renderer,
  gridX: number,
  gridY: number,
  tripped: boolean,
  throttleFactor: number,
): void {
  if (!tripped && throttleFactor >= 1) return;

  const ctx = renderer.context;
  const centerX = gridX * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;
  const badgeY = gridY * GRID_CELL_SIZE - 8;

  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = tripped ? RACK_LABEL_OVER_COLOR : '#f7b731';
  ctx.fillText(tripped ? '⛔ OVERHEATED' : '🌡 THROTTLED', centerX, badgeY);
}

// A placed CRAC unit and its coverage ring. See .plans/thermal-and-cooling.md D4/Step 7.
function drawCoolingUnit(
  renderer: Renderer,
  gridX: number,
  gridY: number,
  radiusCells: number,
  showRing: boolean,
): void {
  const ctx = renderer.context;
  const x = gridX * GRID_CELL_SIZE + RACK_PADDING;
  const y = gridY * GRID_CELL_SIZE + RACK_PADDING;
  const size = GRID_CELL_SIZE - RACK_PADDING * 2;
  const centerX = gridX * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;
  const centerY = gridY * GRID_CELL_SIZE + GRID_CELL_SIZE / 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(x + 2, y + 3, size, size);

  ctx.fillStyle = '#2b4a5c';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = '#1c333f';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, size, size);

  ctx.font = `${size * 0.55}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('❄', centerX, centerY + 1);

  // Faint always-on ring so coverage is legible without opening build mode; strong+solid while
  // actively placing (D8 point 3 — coverage must be plannable before committing).
  ctx.save();
  ctx.strokeStyle = showRing ? 'rgba(93, 179, 235, 0.85)' : 'rgba(93, 179, 235, 0.22)';
  ctx.lineWidth = showRing ? 2 : 1;
  if (!showRing) ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radiusCells * GRID_CELL_SIZE, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// F7: rises and fades over its lifetime — position/color/text are fixed at spawn (effects.ts),
// this only derives how far in [0,1] the animation is from spawnedAtMs/expiresAtMs, world-space
// so it tracks the rack it was anchored over exactly like any other floor object.
function drawFloatingTexts(renderer: Renderer, world: World): void {
  const ctx = renderer.context;
  const now = performance.now();
  for (const id of world.query(floatingTexts)) {
    const text = world.getComponent(floatingTexts, id)!;
    const total = text.expiresAtMs - text.spawnedAtMs;
    const progress = total > 0 ? Math.min(1, Math.max(0, (now - text.spawnedAtMs) / total)) : 1;

    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = text.color;
    ctx.fillText(text.text, text.worldX, text.worldY - progress * FLOATING_TEXT_RISE_PX);
    ctx.restore();
  }
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

// Points an arrow from the player toward the nearest failed machine's rack — the same "make it
// legible without opening anything" treatment as drawShopHint, since the player is usually
// somewhere else (possibly with the camera panned away, per .plans/thermal-and-cooling.md D8's
// established pattern) when a machine dies. See .plans/hardware-failure.md D7.
function drawFailureHint(renderer: Renderer, world: World, playerPosition: { x: number; y: number }): void {
  let nearestDistance = Infinity;
  let nearestCenter: { x: number; y: number } | null = null;

  for (const machineId of world.query(faileds, installedIns)) {
    const rackId = world.getComponent(installedIns, machineId)!.rackId;
    const grid = world.getComponent(gridPositions, rackId);
    if (!grid) continue;
    const center = gridToWorld(grid.gridX, grid.gridY);
    const distance = Math.hypot(center.x - playerPosition.x, center.y - playerPosition.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestCenter = center;
    }
  }

  if (!nearestCenter || nearestDistance < 60) return;

  const dx = nearestCenter.x - playerPosition.x;
  const dy = nearestCenter.y - playerPosition.y;
  const angle = Math.atan2(dy, dx);
  const arrowDistance = 28;
  const arrowX = playerPosition.x + Math.cos(angle) * arrowDistance;
  const arrowY = playerPosition.y + Math.sin(angle) * arrowDistance - 20;

  const ctx = renderer.context;
  const pulse = (Math.sin(performance.now() / 220) + 1) / 2;
  ctx.save();
  ctx.translate(arrowX, arrowY);
  ctx.rotate(angle);
  ctx.globalAlpha = 0.7 + pulse * 0.3;
  ctx.fillStyle = '#e5484d';
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
  ctx.fillStyle = '#e5484d';
  ctx.fillText('FAILED', arrowX, arrowY - 12);
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

// .plans/hardware-failure.md Step 5: the progress ring/pulse is identical across install,
// repair, and decommission — only the label says what's happening.
const MAINTENANCE_JOB_LABEL: Record<'install' | 'repair' | 'decommission', string> = {
  install: 'Installing…',
  repair: 'Repairing…',
  decommission: 'Removing…',
};

function drawMaintenanceIndicator(world: World, renderer: Renderer, controlled: EntityId): void {
  const task = world.getComponent(maintenanceTasks, controlled);
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

  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e6e8eb';
  ctx.fillText(MAINTENANCE_JOB_LABEL[task.job.kind], center.x, center.y - radius - 8);
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
  // Player-facing labels, not the internal 'dispatching' state-machine name — see
  // .plans/playtest-findings.md F9.
  const modeLabel = panel.mode === 'viewing' ? 'VIEWING (walk there to place work)' : 'PLACING WORK';
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
  const rackLoad = world.getComponent(rackLoads, panel.rackId) ?? {
    powerKw: 0,
    heatKw: 0,
    serverCount: 0,
  };
  const rackTemperature = world.getComponent(temperatures, panel.rackId);
  const tripped = world.getComponent(thermalTrips, panel.rackId) !== undefined;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = RACK_PANEL_DIM;
  let headerStats = `⚡ ${rackLoad.powerKw.toFixed(1)}kW   🔥 ${rackLoad.heatKw.toFixed(1)}kW`;
  if (rackTemperature) {
    headerStats += `   ${Math.round(rackTemperature.celsius)}°C`;
    if (tripped) headerStats += ' ⛔ OVERHEATED';
    else if (rackTemperature.throttleFactor < 1) headerStats += ' 🌡 THROTTLED';
  }
  ctx.fillStyle = tripped ? RACK_LABEL_OVER_COLOR : RACK_PANEL_DIM;
  ctx.fillText(headerStats, closeRect.x - 10, headerY);

  // Server rows + tray both live in the scrollable content region: clip to it and translate up
  // by however far the player has scrolled, so every rect computed below (all laid out in
  // unscrolled content space by getServerRowRect/getTrayCardRect/getPlacedChipRect) ends up in
  // the right place on screen without needing scroll-awareness of its own. Restored before the
  // dragged card below, which must follow the raw cursor in screen space, not content space.
  const contentRect = getRackPanelContentRect(canvasWidth, canvasHeight, serverIds.length, trayIds.length);
  const contentHeight = getRackPanelContentHeight(canvasWidth, serverIds.length, trayIds.length);
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

    const failed = world.getComponent(faileds, serverId) !== undefined;

    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = online ? RACK_PANEL_TEXT : RACK_PANEL_RED;
    // D7: a failed machine reads differently from a merely-offline (brownout/thermal) one —
    // it's the one offline state that never comes back on its own.
    const statusLabel = online ? tier.label : failed ? `${tier.label} (FAILED)` : `${tier.label} (offline)`;
    ctx.fillText(statusLabel, row.x + 6, getServerRowLabelY(row));

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

    // Wear bar — same bar shape as the traits above, in the next slot down (traitIndex ===
    // TRAIT_KEYS.length reuses getServerTraitBarRect's layout for free). Green -> amber -> red
    // as wear climbs (D7).
    const condition = world.getComponent(conditions, serverId);
    if (condition) {
      const wearRect = getServerTraitBarRect(index, TRAIT_KEYS.length, canvasWidth, canvasHeight, serverIds.length, trayIds.length);
      const wearColor = condition.wear > 0.7 ? RACK_PANEL_RED : condition.wear > 0.4 ? RACK_PANEL_AMBER : RACK_PANEL_GREEN;

      ctx.font = '9px sans-serif';
      ctx.fillStyle = failed ? RACK_PANEL_RED : RACK_PANEL_DIM;
      ctx.fillText(`WEAR ${Math.round(condition.wear * 100)}%`, wearRect.x, wearRect.y - 6);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(wearRect.x, wearRect.y, wearRect.width, wearRect.height);
      ctx.fillStyle = wearColor;
      ctx.fillRect(wearRect.x, wearRect.y, wearRect.width * Math.min(1, condition.wear), wearRect.height);
    }

    // Repair/decommission buttons (Step 6). Repair only shown once there's something worth
    // fixing; decommission is always offered (D5's "no way to get rid of a machine" gap).
    if (condition && (condition.wear > REPAIRABLE_WEAR_THRESHOLD || failed)) {
      const repairRect = getServerRepairButtonRect(index, canvasWidth, canvasHeight, serverIds.length, trayIds.length);
      const cost = repairCost(tier.cost, condition.wear);
      ctx.fillStyle = '#2f4f6f';
      ctx.fillRect(repairRect.x, repairRect.y, repairRect.width, repairRect.height);
      ctx.strokeStyle = '#4dabf7';
      ctx.strokeRect(repairRect.x, repairRect.y, repairRect.width, repairRect.height);
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = RACK_PANEL_TEXT;
      ctx.fillText(`Repair $${cost}`, repairRect.x + repairRect.width / 2, repairRect.y + repairRect.height / 2);
    }

    const decommissionRect = getServerDecommissionButtonRect(index, canvasWidth, canvasHeight, serverIds.length, trayIds.length);
    const decommissionConfirm = world.getComponent(decommissionConfirms, controlled);
    const confirmingThis = decommissionConfirm?.serverId === serverId && performance.now() < decommissionConfirm.expiresAtMs;
    ctx.fillStyle = confirmingThis ? '#6f2f2f' : '#3a3f47';
    ctx.fillRect(decommissionRect.x, decommissionRect.y, decommissionRect.width, decommissionRect.height);
    ctx.strokeStyle = confirmingThis ? RACK_PANEL_RED : '#666';
    ctx.strokeRect(decommissionRect.x, decommissionRect.y, decommissionRect.width, decommissionRect.height);
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = RACK_PANEL_TEXT;
    ctx.fillText(
      confirmingThis ? 'Confirm ×' : 'Decommission',
      decommissionRect.x + decommissionRect.width / 2,
      decommissionRect.y + decommissionRect.height / 2,
    );
    ctx.textAlign = 'left';

    // Placed-workload chips, top-right of the row. The one currently being dragged is skipped
    // here — it's drawn once, following the cursor, at the end of this function instead.
    const placedIds = placedWorkloadIds(world, serverId);
    placedIds.forEach((workloadId, chipIndex) => {
      if (drag && drag.workloadId === workloadId) return;

      const chip = getPlacedChipRect(index, chipIndex, canvasWidth, canvasHeight, serverIds.length, trayIds.length);
      const workload = world.getComponent(workloads, workloadId)!;
      const archetype = WORKLOAD_ARCHETYPES[workload.archetypeId];
      // Same "doomed" check as hud.ts's active-workload row: the deadline keeps ticking
      // independent of work-remaining, so a job can be unwinnable while its progress bar still
      // reads green if only work-remaining were shown here.
      const doomed = workload.workRemainingSeconds > workload.deadlineRemainingSeconds;
      const workFraction = 1 - workload.workRemainingSeconds / workload.workSeconds;
      const workRemaining = Math.max(0, Math.ceil(workload.workRemainingSeconds));

      ctx.fillStyle = '#2e343b';
      ctx.fillRect(chip.x, chip.y, chip.width, chip.height);
      ctx.strokeStyle = interactive ? '#4dabf7' : '#555';
      ctx.strokeRect(chip.x, chip.y, chip.width, chip.height);
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = doomed ? RACK_PANEL_RED : RACK_PANEL_TEXT;
      // Only render-farm/training archetypes carry a cooling bonus (web/batch are 0kW — see
      // WORKLOAD_ARCHETYPES); appending it lets the player see, per workload, what's adding to
      // this server's heat line above without opening a separate tooltip. cycleLabel appends
      // "3/5" for a recurring contract (.plans/contract-variety.md D2) — without it, a
      // workload that refuses to disappear on completion looks like a bug.
      const chipLabel =
        archetype.label +
        cycleLabel(workload) +
        (archetype.coolingBonusKw > 0 ? ` 🔥${archetype.coolingBonusKw.toFixed(1)}` : '');
      ctx.fillText(chipLabel, chip.x + 3, chip.y + chip.height * 0.32, chip.width - 6);

      // Second line: how much work is left before this job pays out/completes — a mini
      // progress bar (same fraction hud.ts's active rows compute) plus the seconds countdown,
      // so the player doesn't have to reopen the HUD workload panel to see it.
      const barX = chip.x + 3;
      const barY = chip.y + chip.height * 0.68;
      const barWidth = chip.width - 6 - 24;
      const barHeight = 4;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      ctx.fillStyle = doomed ? RACK_PANEL_RED : RACK_PANEL_GREEN;
      ctx.fillRect(barX, barY, barWidth * Math.min(1, Math.max(0, workFraction)), barHeight);

      ctx.font = '8px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = doomed ? RACK_PANEL_RED : RACK_PANEL_DIM;
      ctx.fillText(`${workRemaining}s`, chip.x + chip.width - 3, chip.y + chip.height * 0.68 + barHeight / 2);
      ctx.textAlign = 'left';
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
      ctx.fillText(archetype.label + cycleLabel(workload), card.x + 6, card.y + card.height * 0.16);

      ctx.font = '8px sans-serif';
      ctx.fillStyle = RACK_PANEL_DIM;
      ctx.fillText(formatDemands(workload.demands), card.x + 6, card.y + card.height * 0.4);

      ctx.font = '9px sans-serif';
      ctx.fillStyle = urgent ? RACK_PANEL_AMBER : RACK_PANEL_DIM;
      ctx.fillText(
        `${Math.max(0, Math.ceil(workload.deadlineRemainingSeconds))}s left`,
        card.x + 6,
        card.y + card.height * 0.64,
      );

      // .plans/contract-variety.md D1: the penalty is what makes leaving this in the tray a
      // real bet, so it stays visible everywhere the deadline countdown does.
      ctx.font = '9px sans-serif';
      ctx.fillStyle = RACK_PANEL_RED;
      ctx.fillText(`-$${workload.penaltyOnMiss.toFixed(0)} if missed`, card.x + 6, card.y + card.height * 0.88);

      // Abandon-contract button (F3) — overlaid in the card's corner rather than a 5th text
      // line, matching the same button geometry input.ts hit-tests against.
      const dropButton = getTrayCardDropButtonRect(index, canvasWidth, canvasHeight, serverIds.length, trayIds.length);
      ctx.fillStyle = 'rgba(229, 72, 77, 0.18)';
      ctx.fillRect(dropButton.x, dropButton.y, dropButton.width, dropButton.height);
      ctx.strokeStyle = RACK_PANEL_RED;
      ctx.lineWidth = 1;
      ctx.strokeRect(dropButton.x, dropButton.y, dropButton.width, dropButton.height);
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = RACK_PANEL_RED;
      ctx.fillText('✕', dropButton.x + dropButton.width / 2, dropButton.y + dropButton.height / 2);
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

      drawOutdoors(renderer);
      drawBuilding(renderer, world, facility);
      drawShopAndCorridor(renderer);
      // Before racks, after the floor (D8) — the cabinet art draws on top of the wash.
      drawHeatOverlay(renderer, world);

      const buildMode = world.getComponent(buildModes, controlled);
      for (const id of world.query(renderables, gridPositions)) {
        const renderable = world.getComponent(renderables, id)!;
        if (renderable.kind !== 'crac') continue;
        const grid = world.getComponent(gridPositions, id)!;
        const coolingUnit = world.getComponent(coolingUnits, id)!;
        drawCoolingUnit(
          renderer,
          grid.gridX,
          grid.gridY,
          coolingUnit.radiusCells,
          buildMode?.buildableId === 'crac',
        );
      }

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

      // .plans/playtest-findings.md F8: the per-rack ⚡/🔥/°C readout used to draw unconditionally
      // under EVERY rack, all the time — fine for a couple of racks, noise once a facility has
      // dozens. Only draw it for the rack under the pointer, or (closet tier, the smallest room)
      // for every rack, since a small facility has too few racks for the noise to matter yet.
      // drawThermalBadge is untouched — it already self-gates on tripped/throttled, the "urgent"
      // signal this declutter is meant to preserve, not hide further.
      const hoverGrid = (() => {
        const pointer = input.getPointerPosition();
        if (!pointer) return null;
        const worldPoint = camera.screenToWorld(pointer);
        return worldToGrid(worldPoint.x, worldPoint.y);
      })();
      const isSmallFacility = (world.getComponent(roomTiers, facility)?.index ?? 0) === 0;

      for (const id of world.query(renderables, gridPositions)) {
        const renderable = world.getComponent(renderables, id)!;
        if (renderable.kind !== 'rack') continue;

        const grid = world.getComponent(gridPositions, id)!;
        const capacity = world.getComponent(rackSlots, id)?.capacity ?? RACK_SLOT_CAPACITY;
        const installedMachines = machinesByRack.get(id) ?? [];

        const slots: SlotState[] = new Array(capacity).fill('empty');
        const tiers: (MachineTierId | null)[] = new Array(capacity).fill(null);
        for (const machineId of installedMachines) {
          const installedIn = world.getComponent(installedIns, machineId)!;
          tiers[installedIn.slotIndex] = world.getComponent(machines, machineId)!.tierId;
          const powered = world.getComponent(powereds, machineId);
          if (!powered?.online) {
            slots[installedIn.slotIndex] = world.getComponent(faileds, machineId) ? 'failed' : 'offline';
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

        drawRack(renderer, grid.gridX, grid.gridY, slots, tiers);

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
          const temperature = world.getComponent(temperatures, id);
          const isHovered = hoverGrid && hoverGrid.gridX === grid.gridX && hoverGrid.gridY === grid.gridY;
          if (isHovered || isSmallFacility) {
            drawRackLoadLabel(
              renderer,
              grid.gridX,
              grid.gridY,
              load,
              facilityOverPower,
              facilityOverCooling,
              temperature,
              worstRackWear(world, installedMachines),
            );
          }
          if (temperature) {
            drawThermalBadge(
              renderer,
              grid.gridX,
              grid.gridY,
              world.getComponent(thermalTrips, id) !== undefined,
              temperature.throttleFactor,
            );
          }
        }
      }

      drawMaintenanceIndicator(world, renderer, controlled);

      for (const id of world.query(renderables, positions)) {
        const renderable = world.getComponent(renderables, id)!;
        if (renderable.kind !== 'player-circle') continue;

        const position = world.getComponent(positions, id)!;
        drawManager(renderer, position.x, position.y);
        drawShopHint(renderer, facility, world, position);
        drawFailureHint(renderer, world, position);
      }

      drawFloatingTexts(renderer, world);

      camera.resetTransform(renderer.context);

      // Everything below is screen-space UI: HUD bar, build/rack panels, pending-deadline
      // border. Drawn outside the camera transform (see .plans/facility-shop-inventory.md D1).
      drawPendingBorder(world, renderer);

      // The rack panel and shop panel are both full-screen modals that replace the build panel
      // rather than drawing over/under it. Same priority order as input.ts's click chain: rack
      // panel first, then shop. A dispatching-mode rack panel draws nothing until the player
      // arrives (see drawRackPanel's early return) — while still walking there, the build panel
      // stays visible instead of leaving the corner blank.
      const rackPanel = world.getComponent(openRackPanels, controlled);
      const rackPanelVisible = rackPanel !== undefined && (rackPanel.mode !== 'dispatching' || rackPanel.arrived);
      if (rackPanelVisible) {
        drawRackPanel(world, renderer, controlled);
      } else if (world.getComponent(shopOpens, controlled)) {
        drawShopPanel(world, renderer, controlled, facility);
      } else {
        drawBuildPanel(world, renderer, controlled, facility, input.getPointerPosition());
      }
    },
  };
}
