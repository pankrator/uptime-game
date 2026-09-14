import { type World, type EntityId } from '../world';
import { workloads, assignments, wallets, reputations, demandClocks } from '../components';
import { REPUTATION_ON_EXPIRY, REPUTATION_ON_COMPLETION } from '../game-data';
import { type System } from './system';

function clampReputation(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function clearAssignmentsFor(world: World, workloadId: EntityId): void {
  for (const machineId of world.query(assignments)) {
    if (world.getComponent(assignments, machineId)!.workloadId === workloadId) {
      world.removeComponent(assignments, machineId);
    }
  }
}

export function createWorkloadRunSystem(world: World, facility: EntityId): System {
  return {
    update(deltaSeconds: number) {
      const wallet = world.getComponent(wallets, facility);
      const reputation = world.getComponent(reputations, facility);
      const clock = world.getComponent(demandClocks, facility);
      if (!wallet || !reputation || !clock) return;

      const assignedComputeByWorkload = new Map<EntityId, number>();
      for (const machineId of world.query(assignments)) {
        const assignment = world.getComponent(assignments, machineId)!;
        assignedComputeByWorkload.set(
          assignment.workloadId,
          (assignedComputeByWorkload.get(assignment.workloadId) ?? 0) + assignment.compute,
        );
      }

      for (const workloadId of world.query(workloads)) {
        const workload = world.getComponent(workloads, workloadId)!;

        if (workload.state === 'pending') {
          workload.graceRemainingSeconds -= deltaSeconds;
          if (workload.graceRemainingSeconds <= 0) {
            reputation.value = clampReputation(reputation.value + REPUTATION_ON_EXPIRY);
            clearAssignmentsFor(world, workloadId);
            world.destroyEntity(workloadId);
          }
          continue;
        }

        wallet.money += workload.payPerSecond * deltaSeconds;
        workload.elapsedSeconds += deltaSeconds;

        if (workload.elapsedSeconds >= workload.durationSeconds) {
          reputation.value = clampReputation(reputation.value + REPUTATION_ON_COMPLETION);
          clock.contractsServed += 1;
          clock.peakComputeServed = Math.max(
            clock.peakComputeServed,
            assignedComputeByWorkload.get(workloadId) ?? workload.demands.cpu,
          );
          clearAssignmentsFor(world, workloadId);
          world.destroyEntity(workloadId);
        }
      }
    },
  };
}
