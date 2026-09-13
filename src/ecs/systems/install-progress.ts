import { type World, type EntityId } from '../world';
import {
  positions,
  gridPositions,
  gridToWorld,
  rackSlots,
  installedIns,
  installTasks,
  wallets,
  GRID_CELL_SIZE,
} from '../components';
import { MACHINE_TIERS } from '../game-data';
import { spawnMachine } from '../../entities';
import { type System } from './system';

const INSTALL_REACH_PX = GRID_CELL_SIZE * 1.2;

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

export function createInstallProgressSystem(
  world: World,
  controlled: EntityId,
  facility: EntityId,
): System {
  return {
    update(deltaSeconds: number) {
      const task = world.getComponent(installTasks, controlled);
      if (!task) return;

      if (!task.arrived) {
        const position = world.getComponent(positions, controlled);
        const grid = world.getComponent(gridPositions, task.rackId);
        if (!position || !grid) return;

        const rackCenter = gridToWorld(grid.gridX, grid.gridY);
        const distance = Math.hypot(rackCenter.x - position.x, rackCenter.y - position.y);
        if (distance <= INSTALL_REACH_PX) {
          task.arrived = true;
        }
        return;
      }

      task.secondsRemaining -= deltaSeconds;
      if (task.secondsRemaining > 0) return;

      const slots = world.getComponent(rackSlots, task.rackId);
      if (!slots) {
        const wallet = world.getComponent(wallets, facility);
        if (wallet) wallet.money += MACHINE_TIERS[task.tierId].cost;
        world.removeComponent(installTasks, controlled);
        return;
      }

      let slotIndex = task.slotIndex;
      const occupied = new Set<number>();
      for (const id of world.query(installedIns)) {
        const installedIn = world.getComponent(installedIns, id)!;
        if (installedIn.rackId === task.rackId) occupied.add(installedIn.slotIndex);
      }
      if (occupied.has(slotIndex)) {
        const freeSlot = findLowestFreeSlot(world, task.rackId, slots.capacity);
        if (freeSlot === null) {
          const wallet = world.getComponent(wallets, facility);
          if (wallet) wallet.money += MACHINE_TIERS[task.tierId].cost;
          world.removeComponent(installTasks, controlled);
          return;
        }
        slotIndex = freeSlot;
      }

      spawnMachine(world, task.rackId, task.tierId, slotIndex);
      world.removeComponent(installTasks, controlled);
    },
  };
}
