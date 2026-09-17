// Walk-to-rack-then-work flow, attached to the player. Renamed from install-progress.ts and
// generalized (.plans/hardware-failure.md D5) to also handle repairing a failed machine and
// decommissioning one entirely — all three share the identical walk/arrival/countdown shape;
// this module only branches at completion.
import { type World, type EntityId } from '../world';
import {
  positions,
  gridPositions,
  gridToWorld,
  rackSlots,
  installedIns,
  maintenanceTasks,
  conditions,
  wallets,
  machines,
  GRID_CELL_SIZE,
} from '../components';
import { MACHINE_TIERS, DECOMMISSION_REFUND_FRACTION, type PurchasableId } from '../game-data';
import { applyRepair } from '../wear';
import { clearFailure } from './wear';
import { spawnMachine } from '../../entities';
import { addToInventory } from '../inventory';
import { type Audio } from '../../audio';
import { type System } from './system';

// Same reach radius/approach as rack-panel.ts's DISPATCH_REACH_PX — the established "close
// enough to interact with this rack" pattern.
const MAINTENANCE_REACH_PX = GRID_CELL_SIZE * 1.2;

function occupiedSlots(world: World, rackId: EntityId): Set<number> {
  const occupied = new Set<number>();
  for (const id of world.query(installedIns)) {
    const installedIn = world.getComponent(installedIns, id)!;
    if (installedIn.rackId === rackId) occupied.add(installedIn.slotIndex);
  }
  return occupied;
}

// Exported for input.ts: F4, one copy instead of two byte-identical bodies.
export function findLowestFreeSlot(world: World, rackId: EntityId, capacity: number): number | null {
  const occupied = occupiedSlots(world, rackId);
  for (let slot = 0; slot < capacity; slot++) {
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

export function createMaintenanceSystem(
  world: World,
  controlled: EntityId,
  facility: EntityId,
  audio: Audio,
): System {
  return {
    update(deltaSeconds: number) {
      const task = world.getComponent(maintenanceTasks, controlled);
      if (!task) return;

      if (!task.arrived) {
        const position = world.getComponent(positions, controlled);
        const grid = world.getComponent(gridPositions, task.rackId);
        if (!position || !grid) return;

        const rackCenter = gridToWorld(grid.gridX, grid.gridY);
        const distance = Math.hypot(rackCenter.x - position.x, rackCenter.y - position.y);
        if (distance <= MAINTENANCE_REACH_PX) {
          task.arrived = true;
        }
        return;
      }

      task.secondsRemaining -= deltaSeconds;
      if (task.secondsRemaining > 0) return;

      const job = task.job;

      if (job.kind === 'install') {
        const slots = world.getComponent(rackSlots, task.rackId);
        if (!slots) {
          // D5 fix: the rack is gone — return the item to INVENTORY, not money. Placement
          // consumes inventory stock (.plans/facility-shop-inventory.md D5), so an abandoned
          // install must give the stock back, not mint cash.
          addToInventory(world, facility, `machine-${job.tierId}` as PurchasableId);
          world.removeComponent(maintenanceTasks, controlled);
          return;
        }

        let slotIndex = job.slotIndex;
        if (occupiedSlots(world, task.rackId).has(slotIndex)) {
          const freeSlot = findLowestFreeSlot(world, task.rackId, slots.capacity);
          if (freeSlot === null) {
            addToInventory(world, facility, `machine-${job.tierId}` as PurchasableId);
            world.removeComponent(maintenanceTasks, controlled);
            return;
          }
          slotIndex = freeSlot;
        }

        spawnMachine(world, task.rackId, job.tierId, slotIndex);
        audio.play('machineInstalled');
        world.removeComponent(maintenanceTasks, controlled);
        return;
      }

      if (job.kind === 'repair') {
        // Cost was already debited up front, when the repair button started this task (see
        // input.ts's tryStartRepair) — completion only applies the effect, same division of
        // labor as install (inventory taken up front, spawnMachine on completion).
        const condition = world.getComponent(conditions, job.machineId);
        if (condition) condition.wear = applyRepair(condition.wear);
        clearFailure(world, job.machineId);

        audio.play('machineRepaired');
        world.removeComponent(maintenanceTasks, controlled);
        return;
      }

      // decommission
      const machine = world.getComponent(machines, job.machineId);
      if (machine) {
        const tier = MACHINE_TIERS[machine.tierId];
        const wallet = world.getComponent(wallets, facility);
        if (wallet) wallet.money += Math.round(tier.cost * DECOMMISSION_REFUND_FRACTION);
        world.destroyEntity(job.machineId);
      }
      audio.play('machineDecommissioned');
      world.removeComponent(maintenanceTasks, controlled);
    },
  };
}
