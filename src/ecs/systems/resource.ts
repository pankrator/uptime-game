import { type World, type EntityId } from '../world';
import {
  machines,
  installedIns,
  powereds,
  placedOns,
  workloads,
  utilizations,
  resourceWarnings,
  powerCapacities,
  coolingCapacities,
  wallets,
  thermalTrips,
  coolingUnits,
  faileds,
  recentlyUnplaceds,
} from '../components';
import {
  MACHINE_TIERS,
  WORKLOAD_ARCHETYPES,
  BROWNOUT_COOLDOWN_SECONDS,
  BROWNOUT_RESTORE_GRACE_SECONDS,
  RESOURCE_WARNING_FRACTION,
  RESOURCE_WARNING_CLEAR_FRACTION,
  IDLE_POWER_FRACTION,
  POWER_COST_PER_KW_SECOND,
  CRAC_UNIT,
} from '../game-data';
import { unplaceWorkload, checkPlacement, placeWorkload } from '../dispatch';
import { spawnToast } from './effects';
import { type EventBus } from '../event-bus';
import { type GameEvents } from '../game-events';
import { type System } from './system';

export interface MachineDraw {
  id: EntityId;
  powerKw: number;
  coolingKw: number;
}

/**
 * Pure ordering: given machines currently online (with their draw), decide which to take
 * offline — newest-first (descending id) — until both power and cooling draw fit within
 * capacity. Returns the set of ids to take offline.
 */
export function selectMachinesToBrownOut(
  online: MachineDraw[],
  powerCapacityKw: number,
  coolingCapacityKw: number,
): Set<EntityId> {
  const sorted = [...online].sort((a, b) => b.id - a.id);
  const offline = new Set<EntityId>();

  let powerDraw = online.reduce((sum, m) => sum + m.powerKw, 0);
  let coolingDraw = online.reduce((sum, m) => sum + m.coolingKw, 0);

  for (const machine of sorted) {
    if (powerDraw <= powerCapacityKw && coolingDraw <= coolingCapacityKw) break;
    offline.add(machine.id);
    powerDraw -= machine.powerKw;
    coolingDraw -= machine.coolingKw;
  }

  return offline;
}

// Workload ids placed on a given server. A server can host several workloads at once, so this
// is a plural lookup.
function workloadsOn(world: World, serverId: EntityId): EntityId[] {
  return world
    .query(placedOns)
    .filter((workloadId) => world.getComponent(placedOns, workloadId)!.serverId === serverId);
}

// Losing a server to a brownout (or a thermal trip) unplaces every workload on it — they
// return to the tray still holding their deadline, a visible/recoverable setback rather than
// silent progress loss. Exported so thermal.ts's/wear.ts's trip/failure handling reuses this
// exactly rather than a second, likely-diverging implementation.
//
// Also tags each unplaced workload with RecentlyUnplaced so that if THIS SAME server comes back
// online within BROWNOUT_RESTORE_GRACE_SECONDS, the online-transition branch below re-places it
// automatically instead of leaving the player to notice and re-drag it for a squeeze that
// already resolved itself.
export function unplaceAllOn(world: World, serverId: EntityId): void {
  const now = performance.now();
  for (const workloadId of workloadsOn(world, serverId)) {
    unplaceWorkload(world, workloadId);
    world.addComponent(recentlyUnplaceds, workloadId, {
      serverId,
      expiresAtMs: now + BROWNOUT_RESTORE_GRACE_SECONDS * 1000,
    });
  }
}

// Exported so capacity.ts's rack-panel draw readout calls this exact function instead of
// duplicating the calculation (the two used to drift).
//
// An ONLINE machine with nothing PLACED on it draws IDLE_POWER_FRACTION of its full
// power/cooling instead of the full amount — previously idle capacity billed exactly like busy
// capacity, so buying ahead of demand (the fun part of a tycoon game) was strictly punished.
export function drawFor(world: World, machineId: EntityId): MachineDraw {
  const machine = world.getComponent(machines, machineId)!;
  const tier = MACHINE_TIERS[machine.tierId];
  const placedWorkloadIds = workloadsOn(world, machineId);
  const idleFraction = placedWorkloadIds.length === 0 ? IDLE_POWER_FRACTION : 1;
  let coolingKw = tier.coolingKw * idleFraction;

  for (const workloadId of placedWorkloadIds) {
    const workload = world.getComponent(workloads, workloadId);
    if (workload) {
      coolingKw += WORKLOAD_ARCHETYPES[workload.archetypeId].coolingBonusKw;
    }
  }

  return { id: machineId, powerKw: tier.powerKw * idleFraction, coolingKw };
}

// The restore half of unplaceAllOn's RecentlyUnplaced tag: a server just came back online —
// re-place any workload still tagged with RecentlyUnplaced for THIS server, if it hasn't
// expired and still fits. One-shot per tag: it's removed here whether or not the restore
// actually happens (already re-placed elsewhere by the player, no longer fits, or the grace
// window lapsed), so a workload is never silently retried forever.
function restoreRecentlyUnplaced(world: World, serverId: EntityId): void {
  const now = performance.now();
  for (const workloadId of world.query(recentlyUnplaceds)) {
    const tag = world.getComponent(recentlyUnplaceds, workloadId)!;
    if (tag.serverId !== serverId) continue;
    world.removeComponent(recentlyUnplaceds, workloadId);
    if (now >= tag.expiresAtMs) continue;
    if (world.getComponent(placedOns, workloadId)) continue; // already placed elsewhere
    if (checkPlacement(world, workloadId, serverId) === null) {
      placeWorkload(world, workloadId, serverId);
    }
  }
}

export function createResourceSystem(world: World, facility: EntityId, events: EventBus<GameEvents>): System {
  return {
    update(deltaSeconds: number) {
      const powerCapacity = world.getComponent(powerCapacities, facility);
      const coolingCapacity = world.getComponent(coolingCapacities, facility);
      const utilization = world.getComponent(utilizations, facility);
      if (!powerCapacity || !coolingCapacity || !utilization) return;

      const machineIds = world.query(machines, installedIns, powereds);

      // Placed CRAC units draw power unconditionally — they have no Powered component and are
      // never brownout candidates ("cooling costs power" is meant to be a flat cost of having
      // them placed, not something that itself flickers under a power crunch). Subtracting
      // their draw from the power budget available to machines keeps the tension real: more
      // CRACs placed leaves less headroom before machines start browning out.
      const cracPowerKw = world.query(coolingUnits).length * CRAC_UNIT.powerKw;

      // Tick cooldowns first so a machine can become recovery-eligible this frame.
      for (const id of machineIds) {
        const powered = world.getComponent(powereds, id)!;
        if (!powered.online && powered.offlineCooldown > 0) {
          powered.offlineCooldown = Math.max(0, powered.offlineCooldown - deltaSeconds);
        }
      }

      // Recovery: online machines plus any offline machine whose cooldown has elapsed are
      // candidates; brownout selection then decides who actually fits. A machine whose rack is
      // thermally tripped is never a candidate — thermal.ts may only force offline, never force
      // online, so this is the one place resource.ts (the sole writer of Powered.online) reads
      // that veto rather than thermal.ts writing the flag itself. Likewise a Failed machine is
      // never a candidate — unlike a brownout/thermal trip, failure has no cooldown-based
      // self-recovery; only a completed repair (maintenance.ts) clears Failed.
      const candidateIds = machineIds.filter((id) => {
        const powered = world.getComponent(powereds, id)!;
        const installedIn = world.getComponent(installedIns, id)!;
        if (world.getComponent(thermalTrips, installedIn.rackId)) return false;
        if (world.getComponent(faileds, id)) return false;
        return powered.online || powered.offlineCooldown <= 0;
      });

      const candidateDraws = candidateIds.map((id) => drawFor(world, id));
      const toOffline = selectMachinesToBrownOut(
        candidateDraws,
        Math.max(0, powerCapacity.kw - cracPowerKw),
        coolingCapacity.kw,
      );
      const candidateSet = new Set(candidateIds);

      let powerDrawKw = 0;
      let coolingDrawKw = 0;

      for (const id of machineIds) {
        const powered = world.getComponent(powereds, id)!;
        const shouldBeOnline = candidateSet.has(id) && !toOffline.has(id);

        if (shouldBeOnline && !powered.online) {
          powered.online = true;
          powered.offlineCooldown = 0;
          restoreRecentlyUnplaced(world, id);
        } else if (!shouldBeOnline && powered.online) {
          powered.online = false;
          powered.offlineCooldown = BROWNOUT_COOLDOWN_SECONDS;
          unplaceAllOn(world, id);
          events.emit('machine:browned-out', { machineId: id });
        }

        if (!powered.online) continue;

        const draw = drawFor(world, id);
        powerDrawKw += draw.powerKw;
        coolingDrawKw += draw.coolingKw;
      }

      utilization.powerDrawKw = powerDrawKw + cracPowerKw;
      utilization.coolingDrawKw = coolingDrawKw;

      // Billed on draw (offline machines already `continue`d above and contribute 0), power +
      // cooling at one rate. Includes CRAC power draw — cooling costs money to run.
      utilization.powerCostPerSecond =
        (powerDrawKw + cracPowerKw + coolingDrawKw) * POWER_COST_PER_KW_SECOND;
      const wallet = world.getComponent(wallets, facility);
      if (wallet) wallet.money -= utilization.powerCostPerSecond * deltaSeconds;

      // Warn before the brownout: fire a one-shot toast the first tick draw crosses
      // RESOURCE_WARNING_FRACTION of capacity, before anything is actually taken offline.
      // RESOURCE_WARNING_CLEAR_FRACTION is the lower hysteresis line draw must fall back under
      // before the SAME warning can fire again, so hovering right at the line doesn't spam a
      // toast every tick.
      const resourceWarning = world.getComponent(resourceWarnings, facility);
      if (resourceWarning) {
        const powerAvailableKw = Math.max(0, powerCapacity.kw - cracPowerKw);
        const powerRatio = powerAvailableKw > 0 ? (powerDrawKw + cracPowerKw) / powerCapacity.kw : 1;
        const coolingRatio = coolingCapacity.kw > 0 ? coolingDrawKw / coolingCapacity.kw : 1;

        if (!resourceWarning.powerNearLimit && powerRatio >= RESOURCE_WARNING_FRACTION) {
          resourceWarning.powerNearLimit = true;
          spawnToast(world, 'Power draw nearing capacity — a brownout may hit soon', '#f5a623');
        } else if (resourceWarning.powerNearLimit && powerRatio < RESOURCE_WARNING_CLEAR_FRACTION) {
          resourceWarning.powerNearLimit = false;
        }

        if (!resourceWarning.coolingNearLimit && coolingRatio >= RESOURCE_WARNING_FRACTION) {
          resourceWarning.coolingNearLimit = true;
          spawnToast(world, 'Cooling draw nearing capacity — a brownout may hit soon', '#f5a623');
        } else if (
          resourceWarning.coolingNearLimit &&
          coolingRatio < RESOURCE_WARNING_CLEAR_FRACTION
        ) {
          resourceWarning.coolingNearLimit = false;
        }
      }
    },
  };
}
