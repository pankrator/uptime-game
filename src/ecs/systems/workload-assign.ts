import { type World, type EntityId } from '../world';
import { machines, powereds, assignments, workloads, installedIns } from '../components';
import { MACHINE_TIERS } from '../game-data';
import { type System } from './system';

/**
 * Greedy smallest-first selection: pick machines in ascending compute order until their
 * combined compute meets `required`. Minimizes stranded compute on the remaining machines.
 * Returns null if the candidates can't cover the requirement.
 */
export function selectMachinesForWorkload(
  candidates: { id: EntityId; compute: number }[],
  required: number,
): EntityId[] | null {
  const total = candidates.reduce((sum, c) => sum + c.compute, 0);
  if (total < required) return null;

  const sorted = [...candidates].sort((a, b) => a.compute - b.compute);
  const selected: EntityId[] = [];
  let sum = 0;
  for (const candidate of sorted) {
    if (sum >= required) break;
    selected.push(candidate.id);
    sum += candidate.compute;
  }
  return selected;
}

export function createWorkloadAssignSystem(world: World): System {
  return {
    update() {
      const pendingWorkloadIds = world
        .query(workloads)
        .filter((id) => world.getComponent(workloads, id)!.state === 'pending')
        .sort((a, b) => a - b);

      if (pendingWorkloadIds.length === 0) return;

      for (const workloadId of pendingWorkloadIds) {
        const workload = world.getComponent(workloads, workloadId)!;

        const candidates = world
          .query(machines, installedIns, powereds)
          .filter((id) => {
            const powered = world.getComponent(powereds, id)!;
            return powered.online && !world.getComponent(assignments, id);
          })
          .map((id) => ({
            id,
            compute: MACHINE_TIERS[world.getComponent(machines, id)!.tierId].compute,
          }));

        const selected = selectMachinesForWorkload(candidates, workload.computeRequired);
        if (!selected) continue;

        for (const machineId of selected) {
          const compute = MACHINE_TIERS[world.getComponent(machines, machineId)!.tierId].compute;
          world.addComponent(assignments, machineId, { workloadId, compute });
        }
        workload.state = 'running';
      }
    },
  };
}
