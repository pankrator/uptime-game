import { type World, type EntityId } from '../world';
import {
  machines,
  installedIns,
  powereds,
  assignments,
  workloads,
  utilizations,
  powerCapacities,
  coolingCapacities,
} from '../components';
import { MACHINE_TIERS, WORKLOAD_ARCHETYPES, BROWNOUT_COOLDOWN_SECONDS } from '../game-data';
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

function unassign(world: World, machineId: EntityId): void {
  const assignment = world.getComponent(assignments, machineId);
  if (!assignment) return;

  world.removeComponent(assignments, machineId);

  const workload = world.getComponent(workloads, assignment.workloadId);
  if (!workload || workload.state !== 'running') return;

  const remainingCompute = world
    .query(assignments)
    .filter((id) => world.getComponent(assignments, id)!.workloadId === assignment.workloadId)
    .reduce((sum, id) => sum + world.getComponent(assignments, id)!.compute, 0);

  if (remainingCompute < workload.demands.cpu) {
    workload.state = 'pending';
  }
}

function drawFor(world: World, machineId: EntityId): MachineDraw {
  const machine = world.getComponent(machines, machineId)!;
  const tier = MACHINE_TIERS[machine.tierId];
  let coolingKw = tier.coolingKw;

  const assignment = world.getComponent(assignments, machineId);
  if (assignment) {
    const workload = world.getComponent(workloads, assignment.workloadId);
    if (workload && workload.state === 'running') {
      coolingKw += WORKLOAD_ARCHETYPES[workload.archetypeId].coolingBonusKw;
    }
  }

  return { id: machineId, powerKw: tier.powerKw, coolingKw };
}

export function createResourceSystem(world: World, facility: EntityId): System {
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
          unassign(world, id);
        }

        if (!powered.online) continue;

        const draw = drawFor(world, id);
        powerDrawKw += draw.powerKw;
        coolingDrawKw += draw.coolingKw;

        const machine = world.getComponent(machines, id)!;
        const tier = MACHINE_TIERS[machine.tierId];
        computeTotal += tier.traits.cpu;
        if (!world.getComponent(assignments, id)) {
          computeFree += tier.traits.cpu;
        }
      }

      utilization.powerDrawKw = powerDrawKw;
      utilization.coolingDrawKw = coolingDrawKw;
      utilization.computeTotal = computeTotal;
      utilization.computeFree = computeFree;
    },
  };
}
