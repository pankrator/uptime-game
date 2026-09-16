import { type World, type EntityId } from '../world';
import {
  machines,
  installedIns,
  powereds,
  placedOns,
  workloads,
  utilizations,
  powerCapacities,
  coolingCapacities,
  wallets,
  thermalTrips,
  coolingUnits,
  faileds,
} from '../components';
import {
  MACHINE_TIERS,
  WORKLOAD_ARCHETYPES,
  BROWNOUT_COOLDOWN_SECONDS,
  POWER_COST_PER_KW_SECOND,
  CRAC_UNIT,
} from '../game-data';
import { unplaceWorkload } from '../dispatch';
import { type Audio } from '../../audio';
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

// Workload ids placed on a given server. A server can host several workloads at once (D1: one
// workload per server, not one server per workload), so this is a plural lookup — the inverse
// of the old Assignment, which lived on the machine and was 1:1.
function workloadsOn(world: World, serverId: EntityId): EntityId[] {
  return world
    .query(placedOns)
    .filter((workloadId) => world.getComponent(placedOns, workloadId)!.serverId === serverId);
}

// Losing a server to a brownout (or, per .plans/thermal-and-cooling.md D6, a thermal trip)
// unplaces every workload on it — they return to the tray still holding their deadline, a
// visible/recoverable setback rather than silent progress loss (see .plans/workload-dispatch.md,
// "Changed: resource.ts"). Exported so thermal.ts's trip handling reuses this exactly rather
// than a second, likely-diverging implementation (D6: "no new failure path").
export function unplaceAllOn(world: World, serverId: EntityId): void {
  for (const workloadId of workloadsOn(world, serverId)) {
    unplaceWorkload(world, workloadId);
  }
}

function drawFor(world: World, machineId: EntityId): MachineDraw {
  const machine = world.getComponent(machines, machineId)!;
  const tier = MACHINE_TIERS[machine.tierId];
  let coolingKw = tier.coolingKw;

  for (const workloadId of workloadsOn(world, machineId)) {
    const workload = world.getComponent(workloads, workloadId);
    if (workload) {
      coolingKw += WORKLOAD_ARCHETYPES[workload.archetypeId].coolingBonusKw;
    }
  }

  return { id: machineId, powerKw: tier.powerKw, coolingKw };
}

export function createResourceSystem(world: World, facility: EntityId, audio: Audio): System {
  return {
    update(deltaSeconds: number) {
      const powerCapacity = world.getComponent(powerCapacities, facility);
      const coolingCapacity = world.getComponent(coolingCapacities, facility);
      const utilization = world.getComponent(utilizations, facility);
      if (!powerCapacity || !coolingCapacity || !utilization) return;

      const machineIds = world.query(machines, installedIns, powereds);

      // Placed CRAC units draw power unconditionally — they have no Powered component and are
      // never brownout candidates (D4/Step 1: "cooling costs power" is meant to be a flat cost
      // of having them placed, not something that itself flickers under a power crunch).
      // Subtracting their draw from the power budget available to machines keeps the tension
      // real: more CRACs placed leaves less headroom before machines start browning out.
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
      // thermally tripped is never a candidate — see .plans/thermal-and-cooling.md D7: thermal.ts
      // may only force offline, never force online, so this is the one place resource.ts (the
      // sole writer of Powered.online) reads that veto rather than thermal.ts writing the flag
      // itself. Likewise a Failed machine (.plans/hardware-failure.md D4/D7) is never a
      // candidate — unlike a brownout/thermal trip, failure has no cooldown-based
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
      let computeTotal = 0;
      let computeFree = 0;

      for (const id of machineIds) {
        const powered = world.getComponent(powereds, id)!;
        const shouldBeOnline = candidateSet.has(id) && !toOffline.has(id);

        if (shouldBeOnline && !powered.online) {
          powered.online = true;
          powered.offlineCooldown = 0;
        } else if (!shouldBeOnline && powered.online) {
          powered.online = false;
          powered.offlineCooldown = BROWNOUT_COOLDOWN_SECONDS;
          unplaceAllOn(world, id);
          audio.play('brownout');
        }

        if (!powered.online) continue;

        const draw = drawFor(world, id);
        powerDrawKw += draw.powerKw;
        coolingDrawKw += draw.coolingKw;

        const machine = world.getComponent(machines, id)!;
        const tier = MACHINE_TIERS[machine.tierId];
        computeTotal += tier.traits.cpu;
        const used = workloadsOn(world, id).reduce(
          (sum, workloadId) => sum + (world.getComponent(workloads, workloadId)?.demands.cpu ?? 0),
          0,
        );
        computeFree += Math.max(0, tier.traits.cpu - used);
      }

      utilization.powerDrawKw = powerDrawKw + cracPowerKw;
      utilization.coolingDrawKw = coolingDrawKw;
      utilization.computeTotal = computeTotal;
      utilization.computeFree = computeFree;

      // .plans/power-billing.md D1/D2: billed on draw (offline machines already `continue`d
      // above and contribute 0), power + cooling at one rate. Includes CRAC power draw
      // (.plans/thermal-and-cooling.md Step 1) — cooling costs money to run.
      utilization.powerCostPerSecond =
        (powerDrawKw + cracPowerKw + coolingDrawKw) * POWER_COST_PER_KW_SECOND;
      const wallet = world.getComponent(wallets, facility);
      if (wallet) wallet.money -= utilization.powerCostPerSecond * deltaSeconds;
    },
  };
}
