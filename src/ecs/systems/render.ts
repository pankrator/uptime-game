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
  machines,
  installedIns,
  powereds,
  installTasks,
  wallets,
} from '../components';
import { RACK_SLOT_CAPACITY } from '../game-data';
import { type Renderer } from '../../rendering';
import { getBuildPanelEntryRect } from '../../ui/layout';
import { type System } from './system';

const PLAYER_RADIUS = 12;
const BUILDING_WALL_THICKNESS = 8;

function drawBuilding(renderer: Renderer): void {
  const { width, height } = renderer.canvas;
  const ctx = renderer.context;

  const x = BUILDING_MARGIN;
  const y = BUILDING_MARGIN;
  const w = width - BUILDING_MARGIN * 2;
  const h = height - BUILDING_MARGIN * 2;

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
  for (let gx = 0; gx <= width; gx += GRID_CELL_SIZE) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, height);
    ctx.stroke();
  }
  for (let gy = 0; gy <= height; gy += GRID_CELL_SIZE) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(width, gy);
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
}

const RACK_PADDING = 4;

type SlotState = 'empty' | 'online-idle' | 'online-busy' | 'offline';

const SLOT_SLAT_FILL: Record<SlotState, string> = {
  empty: '#22262b',
  'online-idle': '#2e343b',
  'online-busy': '#2e343b',
  offline: '#22262b',
};

const SLOT_LED_COLOR: Record<SlotState, string | null> = {
  empty: null,
  'online-idle': '#f7b731',
  'online-busy': '#3ddc84',
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

const MONEY_READOUT_MARGIN = 12;

function drawMoneyReadout(world: World, renderer: Renderer, facility: EntityId): void {
  const wallet = world.getComponent(wallets, facility);
  const money = wallet ? Math.floor(wallet.money) : 0;

  const ctx = renderer.context;
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#3ddc84';
  ctx.fillText(`$${money}`, MONEY_READOUT_MARGIN, MONEY_READOUT_MARGIN);
}

function drawBuildPanel(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  facility: EntityId,
): void {
  const buildMode = world.getComponent(buildModes, controlled);
  const wallet = world.getComponent(wallets, facility);
  const money = wallet ? Math.floor(wallet.money) : 0;

  renderer.context.font = '14px sans-serif';
  renderer.context.textAlign = 'center';
  renderer.context.textBaseline = 'middle';

  BUILDABLES.forEach((buildable, index) => {
    const rect = getBuildPanelEntryRect(index, renderer.canvas.height);
    const isSelected = buildMode?.buildableId === buildable.id;
    const affordable = money >= buildable.cost;

    renderer.context.fillStyle = isSelected ? '#4dabf7' : '#333';
    renderer.context.globalAlpha = affordable ? 1 : 0.45;
    renderer.context.fillRect(rect.x, rect.y, rect.width, rect.height);
    renderer.context.strokeStyle = isSelected ? '#fff' : '#666';
    renderer.context.lineWidth = 2;
    renderer.context.strokeRect(rect.x, rect.y, rect.width, rect.height);

    renderer.context.fillStyle = '#fff';
    renderer.context.fillText(
      `${buildable.label}  $${buildable.cost}`,
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    renderer.context.globalAlpha = 1;
  });
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

export function createRenderSystem(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  facility: EntityId,
): System {
  return {
    update() {
      drawBuilding(renderer);

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
          slots[installedIn.slotIndex] = powered?.online ? 'online-idle' : 'offline';
        }

        drawRack(renderer, grid.gridX, grid.gridY, slots);
      }

      drawInstallIndicator(world, renderer, controlled);

      for (const id of world.query(renderables, positions)) {
        const renderable = world.getComponent(renderables, id)!;
        if (renderable.kind !== 'player-circle') continue;

        const position = world.getComponent(positions, id)!;
        drawManager(renderer, position.x, position.y);
      }

      drawBuildPanel(world, renderer, controlled, facility);
      drawMoneyReadout(world, renderer, facility);
    },
  };
}
