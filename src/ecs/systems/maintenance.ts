// Walk-to-rack-then-work flow, attached to the player. Handles installing a bought machine,
// repairing a failed one, and decommissioning one entirely — all three share the identical
// walk/arrival/countdown shape; createMaintenanceSystem only branches at completion. This module
// also owns starting each task (startInstall/startRepair/startDecommission) and cancelling one
// (cancelMaintenanceTask) — the module that finishes a MaintenanceTask is the one that creates
// it, rather than that split across this file and input.ts.
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
  pathFollows,
  moveTargets,
  GRID_CELL_SIZE,
} from '../components';
import {
  MACHINE_TIERS,
  DECOMMISSION_REFUND_FRACTION,
  DECOMMISSION_SECONDS,
  type MachineTierId,
  type PurchasableId,
} from '../game-data';
import { applyRepair, repairCost, repairSeconds } from '../wear';
import { clearFailure } from './wear';
import { spawnMachine } from '../../entities';
import { addToInventory, takeFromInventory } from '../inventory';
import { unplaceAllOn } from '../dispatch';
import { moveControlledTo } from '../movement-commands';
import { type EventBus } from '../event-bus';
import { type GameEvents } from '../game-events';
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

// Exported for input.ts, so there's one copy instead of two byte-identical bodies.
export function findLowestFreeSlot(
  world: World,
  rackId: EntityId,
  capacity: number,
): number | null {
  const occupied = occupiedSlots(world, rackId);
  for (let slot = 0; slot < capacity; slot++) {
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

// Cancelling refunds whatever was taken up front — the item to INVENTORY for an install (it was
// bought at the shop and is still owned; only the install itself was abandoned) or the
// wear-scaled fee to the WALLET for a repair. A decommission has nothing to refund: its payout
// only happens on completion (below), never up front.
export function cancelMaintenanceTask(
  world: World,
  facility: EntityId,
  controlled: EntityId,
): void {
  const task = world.getComponent(maintenanceTasks, controlled);
  if (!task) return;

  if (task.job.kind === 'install') {
    addToInventory(world, facility, `machine-${task.job.tierId}` as PurchasableId);
  } else if (task.job.kind === 'repair') {
    const wallet = world.getComponent(wallets, facility);
    if (wallet) wallet.money += task.job.cost;
  }

  world.removeComponent(maintenanceTasks, controlled);
  world.removeComponent(pathFollows, controlled);
  world.removeComponent(moveTargets, controlled);
}

// This is the module that finishes an install, so it's also the one that starts it. Takes
// rackId directly (callers already resolve it via rack-panel.ts's findRackAt) rather than a grid
// cell, so this module never needs to depend on rack-panel.ts.
export function startInstall(
  world: World,
  controlled: EntityId,
  facility: EntityId,
  tierId: MachineTierId,
  rackId: EntityId,
): void {
  const slots = world.getComponent(rackSlots, rackId);
  if (!slots) return;

  const slotIndex = findLowestFreeSlot(world, rackId, slots.capacity);
  if (slotIndex === null) return;

  const tier = MACHINE_TIERS[tierId];
  if (!takeFromInventory(world, facility, `machine-${tierId}` as PurchasableId)) return;

  const grid = world.getComponent(gridPositions, rackId);
  if (grid) moveControlledTo(world, controlled, facility, gridToWorld(grid.gridX, grid.gridY));

  world.addComponent(maintenanceTasks, controlled, {
    rackId,
    job: { kind: 'install', tierId, slotIndex },
    secondsRemaining: tier.installSeconds,
    totalSeconds: tier.installSeconds,
    arrived: false,
  });
}

// Repair/decommission both queue a MaintenanceTask exactly like install does — click from
// anywhere (viewing-mode panel included), then walk there, then the work happens.
export function startRepair(
  world: World,
  controlled: EntityId,
  facility: EntityId,
  serverId: EntityId,
): void {
  if (world.getComponent(maintenanceTasks, controlled)) return;

  const condition = world.getComponent(conditions, serverId);
  const machine = world.getComponent(machines, serverId);
  const installedIn = world.getComponent(installedIns, serverId);
  if (!condition || !machine || !installedIn) return;

  const grid = world.getComponent(gridPositions, installedIn.rackId);
  if (!grid) return;

  const tier = MACHINE_TIERS[machine.tierId];
  const cost = repairCost(tier.cost, condition.wear);
  const wallet = world.getComponent(wallets, facility);
  if (!wallet || Math.floor(wallet.money) < cost) return;
  wallet.money -= cost;

  const seconds = repairSeconds(condition.wear);
  moveControlledTo(world, controlled, facility, gridToWorld(grid.gridX, grid.gridY));
  world.addComponent(maintenanceTasks, controlled, {
    rackId: installedIn.rackId,
    job: { kind: 'repair', machineId: serverId, cost },
    secondsRemaining: seconds,
    totalSeconds: seconds,
    arrived: false,
  });
}

export function startDecommission(
  world: World,
  controlled: EntityId,
  facility: EntityId,
  serverId: EntityId,
): void {
  if (world.getComponent(maintenanceTasks, controlled)) return;

  const installedIn = world.getComponent(installedIns, serverId);
  if (!installedIn) return;
  const grid = world.getComponent(gridPositions, installedIn.rackId);
  if (!grid) return;

  moveControlledTo(world, controlled, facility, gridToWorld(grid.gridX, grid.gridY));
  world.addComponent(maintenanceTasks, controlled, {
    rackId: installedIn.rackId,
    job: { kind: 'decommission', machineId: serverId },
    secondsRemaining: DECOMMISSION_SECONDS,
    totalSeconds: DECOMMISSION_SECONDS,
    arrived: false,
  });
}

export function createMaintenanceSystem(
  world: World,
  controlled: EntityId,
  facility: EntityId,
  events: EventBus<GameEvents>,
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
          // The rack is gone — return the item to INVENTORY, not money. Placement consumes
          // inventory stock, so an abandoned install must give the stock back, not mint cash.
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

        const machineId = spawnMachine(world, task.rackId, job.tierId, slotIndex);
        events.emit('machine:installed', { machineId, rackId: task.rackId });
        world.removeComponent(maintenanceTasks, controlled);
        return;
      }

      if (job.kind === 'repair') {
        // Cost was already debited up front, when the repair button started this task (see
        // startRepair above) — completion only applies the effect, same division of labor as
        // install (inventory taken up front, spawnMachine on completion).
        const condition = world.getComponent(conditions, job.machineId);
        if (condition) condition.wear = applyRepair(condition.wear);
        clearFailure(world, job.machineId);

        events.emit('machine:repaired', { machineId: job.machineId });
        world.removeComponent(maintenanceTasks, controlled);
        return;
      }

      // decommission
      const machine = world.getComponent(machines, job.machineId);
      if (machine) {
        const tier = MACHINE_TIERS[machine.tierId];
        const wallet = world.getComponent(wallets, facility);
        if (wallet) wallet.money += Math.round(tier.cost * DECOMMISSION_REFUND_FRACTION);
        // PlacedOn lives on the WORKLOAD, so destroying the machine would not clear it:
        // anything still placed here would keep a serverId nobody can resolve, freezing the
        // contract (no progress, no pay, not in the tray to re-drag) until its deadline ran
        // out. No restore tag — this server is not coming back.
        unplaceAllOn(world, job.machineId);
        world.destroyEntity(job.machineId);
      }
      events.emit('machine:decommissioned', { machineId: job.machineId });
      world.removeComponent(maintenanceTasks, controlled);
    },
  };
}
