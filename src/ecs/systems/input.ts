import { type World, type EntityId } from '../world';
import {
  positions,
  moveTargets,
  pathFollows,
  gridPositions,
  gridToWorld,
  worldToGrid,
  buildModes,
  BUILDABLES,
  wallets,
  rackSlots,
  installedIns,
  installTasks,
  powerCapacities,
  coolingCapacities,
  offers,
  type BuildableDef,
} from '../components';
import { acceptOffer, declineOffer } from '../dispatch';
import {
  getFloorGridBounds,
  isWalkable,
  findPath,
  findNearestWalkableNeighbor,
  simplifyPathToPixels,
} from '../pathfinding';
import {
  MACHINE_TIERS,
  POWER_UPGRADE_KW,
  COOLING_UPGRADE_KW,
  type MachineTierId,
} from '../game-data';
import { type InputState } from '../../input';
import { spawnRack } from '../../entities';
import { type Renderer } from '../../rendering';
import {
  getBuildPanelEntryRect,
  pointerInRect,
  pointerInHud,
  getOfferButtonRect,
} from '../../ui/layout';
import { type System } from './system';

interface OfferButtonHit {
  offerId: EntityId;
  kind: 'accept' | 'decline';
}

function hitTestOfferButtons(
  world: World,
  point: { x: number; y: number },
): OfferButtonHit | null {
  const offerIds = world.query(offers).sort((a, b) => a - b);
  for (let index = 0; index < offerIds.length; index++) {
    if (pointerInRect(point, getOfferButtonRect(index, 'accept'))) {
      return { offerId: offerIds[index], kind: 'accept' };
    }
    if (pointerInRect(point, getOfferButtonRect(index, 'decline'))) {
      return { offerId: offerIds[index], kind: 'decline' };
    }
  }
  return null;
}

function hitTestPanel(point: { x: number; y: number }, canvasHeight: number): number | null {
  for (let index = 0; index < BUILDABLES.length; index++) {
    const rect = getBuildPanelEntryRect(index, canvasHeight);
    if (pointerInRect(point, rect)) {
      return index;
    }
  }
  return null;
}

function isGridCellOccupied(world: World, gridX: number, gridY: number): boolean {
  return world.query(gridPositions).some((id) => {
    const grid = world.getComponent(gridPositions, id)!;
    return grid.gridX === gridX && grid.gridY === gridY;
  });
}

function findRackAt(world: World, gridX: number, gridY: number): EntityId | null {
  for (const id of world.query(rackSlots, gridPositions)) {
    const grid = world.getComponent(gridPositions, id)!;
    if (grid.gridX === gridX && grid.gridY === gridY) return id;
  }
  return null;
}

function findLowestFreeSlot(world: World, rackId: EntityId, capacity: number): number | null {
  const occupied = new Set<number>();
  for (const id of world.query(installedIns)) {
    const installedIn = world.getComponent(installedIns, id)!;
    if (installedIn.rackId === rackId) occupied.add(installedIn.slotIndex);
  }
  for (let slot = 0; slot < capacity; slot++) {
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

function canAfford(world: World, facility: EntityId, cost: number): boolean {
  const wallet = world.getComponent(wallets, facility);
  if (!wallet) return false;
  return Math.floor(wallet.money) >= cost;
}

function moveControlledTo(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  targetPixel: { x: number; y: number },
): void {
  const position = world.getComponent(positions, controlled);
  if (!position) return;

  const bounds = getFloorGridBounds(renderer.canvas);
  const start = worldToGrid(position.x, position.y);
  const { gridX: targetGridX, gridY: targetGridY } = worldToGrid(targetPixel.x, targetPixel.y);

  const targetIsWalkable = isWalkable(world, bounds, targetGridX, targetGridY);
  const goal = targetIsWalkable
    ? { gridX: targetGridX, gridY: targetGridY }
    : findNearestWalkableNeighbor(world, bounds, { gridX: targetGridX, gridY: targetGridY }, start);

  if (!goal) return;

  const path = findPath(world, bounds, start, goal);
  if (path === null) return;

  // Exact click point when it's reachable; otherwise the neighbor cell's center, since the
  // click landed on an obstacle and there's no exact point on it to walk to.
  const endPixel = targetIsWalkable ? targetPixel : gridToWorld(goal.gridX, goal.gridY);

  world.removeComponent(moveTargets, controlled);

  const simplified = simplifyPathToPixels(world, bounds, position, path, endPixel);
  world.addComponent(pathFollows, controlled, { path: simplified, index: 0 });
}

function cancelInstallTask(world: World, facility: EntityId, controlled: EntityId): void {
  const task = world.getComponent(installTasks, controlled);
  if (!task) return;

  const wallet = world.getComponent(wallets, facility);
  if (wallet) {
    wallet.money += MACHINE_TIERS[task.tierId].cost;
  }

  world.removeComponent(installTasks, controlled);
  world.removeComponent(pathFollows, controlled);
  world.removeComponent(moveTargets, controlled);
}

function tryInstallIntoRack(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  facility: EntityId,
  tierId: MachineTierId,
  gridX: number,
  gridY: number,
): void {
  const rackId = findRackAt(world, gridX, gridY);
  if (rackId === null) return;

  const slots = world.getComponent(rackSlots, rackId)!;
  const slotIndex = findLowestFreeSlot(world, rackId, slots.capacity);
  if (slotIndex === null) return;

  const tier = MACHINE_TIERS[tierId];
  if (!canAfford(world, facility, tier.cost)) return;

  const wallet = world.getComponent(wallets, facility)!;
  wallet.money -= tier.cost;

  moveControlledTo(world, renderer, controlled, gridToWorld(gridX, gridY));

  world.addComponent(installTasks, controlled, {
    rackId,
    tierId,
    slotIndex,
    secondsRemaining: tier.installSeconds,
    totalSeconds: tier.installSeconds,
    arrived: false,
  });
}

function applyPurchase(world: World, facility: EntityId, buildable: BuildableDef): void {
  if (!canAfford(world, facility, buildable.cost)) return;
  const wallet = world.getComponent(wallets, facility)!;
  wallet.money -= buildable.cost;

  if (buildable.id === 'power-upgrade') {
    const powerCapacity = world.getComponent(powerCapacities, facility)!;
    powerCapacity.kw += POWER_UPGRADE_KW;
  } else if (buildable.id === 'cooling-upgrade') {
    const coolingCapacity = world.getComponent(coolingCapacities, facility)!;
    coolingCapacity.kw += COOLING_UPGRADE_KW;
  }
}

function selectBuildable(world: World, facility: EntityId, controlled: EntityId, selected: BuildableDef): void {
  if (selected.placement === 'purchase') {
    applyPurchase(world, facility, selected);
    return;
  }

  const buildMode = world.getComponent(buildModes, controlled);
  if (buildMode?.buildableId === selected.id) {
    world.removeComponent(buildModes, controlled);
  } else {
    world.addComponent(buildModes, controlled, { buildableId: selected.id });
  }
}

export function createInputSystem(
  world: World,
  input: InputState,
  renderer: Renderer,
  controlled: EntityId,
  facility: EntityId,
): System {
  input.onKeyDown('Escape', () => {
    if (world.getComponent(buildModes, controlled)) {
      world.removeComponent(buildModes, controlled);
    }
  });

  BUILDABLES.forEach((buildable, index) => {
    const key = String(index + 1);
    input.onKeyDown(key, () => {
      if (world.getComponent(installTasks, controlled)) return;
      selectBuildable(world, facility, controlled, buildable);
    });
  });

  return {
    update() {
      if (!input.wasClicked()) return;

      const pointer = input.getPointerPosition();
      if (!pointer) return;

      // 0. Offer Accept/Decline — checked before the general HUD-blocking test since offer
      // cards live inside the HUD region; this branch owns clicks there regardless of any
      // other in-progress interaction (an install task or build mode should not swallow it).
      const offerHit = hitTestOfferButtons(world, pointer);
      if (offerHit) {
        if (offerHit.kind === 'accept') {
          acceptOffer(world, offerHit.offerId);
        } else {
          declineOffer(world, offerHit.offerId);
        }
        return;
      }

      if (pointerInHud(pointer, renderer.canvas, world.query(offers).length)) return;

      // 1. Install in progress → any click cancels and refunds.
      if (world.getComponent(installTasks, controlled)) {
        cancelInstallTask(world, facility, controlled);
        return;
      }

      const panelIndex = hitTestPanel(pointer, renderer.canvas.height);
      const buildMode = world.getComponent(buildModes, controlled);

      // 2. Panel hit.
      if (panelIndex !== null) {
        selectBuildable(world, facility, controlled, BUILDABLES[panelIndex]);
        return;
      }

      // 3. Build mode active.
      if (buildMode) {
        const buildable = BUILDABLES.find((b) => b.id === buildMode.buildableId)!;
        const { gridX, gridY } = worldToGrid(pointer.x, pointer.y);

        if (buildable.placement === 'empty-cell') {
          if (!canAfford(world, facility, buildable.cost)) return;
          if (isGridCellOccupied(world, gridX, gridY)) return;

          const wallet = world.getComponent(wallets, facility)!;
          wallet.money -= buildable.cost;
          spawnRack(world, gridX, gridY);
          // Stay in build mode so a row of racks can be laid out quickly.
          return;
        }

        if (buildable.placement === 'rack') {
          // buildable.id is `machine-${MachineTierId}` for every rack-placement buildable —
          // strip the prefix rather than hand-matching each tier id (see BUILDABLES in
          // components.ts, generated from MACHINE_TIERS).
          const tierId = buildable.id.slice('machine-'.length) as MachineTierId;
          tryInstallIntoRack(world, renderer, controlled, facility, tierId, gridX, gridY);
          world.removeComponent(buildModes, controlled);
          return;
        }

        return;
      }

      // 4. No build mode.
      moveControlledTo(world, renderer, controlled, pointer);
    },
  };
}
