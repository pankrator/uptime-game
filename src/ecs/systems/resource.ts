import { type World, type EntityId } from '../world';
import { machines, installedIns, powereds, placedOns, workloads, utilizations, powerCapacities, coolingCapacities, wallets } from '../components';
import { MACHINE_TIERS, WORKLOAD_ARCHETYPES, BROWNOUT_COOLDOWN_SECONDS, POWER_COST_PER_KW_SECOND } from '../game-data';
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

// Losing a server to a brownout unplaces every workload on it — they return to the tray still
// holding their deadline, a visible/recoverable setback rather than silent progress loss (see
// .plans/workload-dispatch.md, "Changed: resource.ts").
function unplaceAllOn(world: World, serverId: EntityId): void {
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

      // Tick cooldowns first so a machine can become recovery-eligible this frame.
      for (const id of machineIds) {
        const powered = world.getComponent(powereds, id)!;
        if (!powered.online && powered.offlineCooldown > 0) {
          powered.offlineCooldown = Math.max(0, powered.offlineCooldown - deltaSeconds);
        }
      }

      // Recovery: online machines plus any offline machine whose cooldown has elapsed are
      // candidates; brownout selection then decides who actually fits.
      const candidateIds = machineIds.filter((id) => {
        const powered = world.getComponent(powereds, id)!;
        return powered.online || powered.offlineCooldown <= 0;
      });

      const candidateDraws = candidateIds.map((id) => drawFor(world, id));
      const toOffline = selectMachinesToBrownOut(candidateDraws, powerCapacity.kw, coolingCapacity.kw);
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

      utilization.powerDrawKw = powerDrawKw;
      utilization.coolingDrawKw = coolingDrawKw;
      utilization.computeTotal = computeTotal;
      utilization.computeFree = computeFree;

      // .plans/power-billing.md D1/D2: billed on draw (offline machines already `continue`d
      // above and contribute 0), power + cooling at one rate.
      utilization.powerCostPerSecond = (powerDrawKw + coolingDrawKw) * POWER_COST_PER_KW_SECOND;
      const wallet = world.getComponent(wallets, facility);
      if (wallet) wallet.money -= utilization.powerCostPerSecond * deltaSeconds;
    },
  };
}
