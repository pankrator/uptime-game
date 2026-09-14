import { type World, type EntityId } from '../world';
import { workloads, placedOns, powereds, wallets, reputations, demandClocks } from '../components';
import { REPUTATION_ON_MISSED_DEADLINE, REPUTATION_ON_COMPLETION } from '../game-data';
import { type System } from './system';

function clampReputation(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// D2: a single finish deadline, not separate start/finish deadlines. Per workload, every tick:
//   1. deadlineRemainingSeconds -= dt, ALWAYS — whether sitting in the tray or running.
//   2. If placed and its server is online: workRemainingSeconds -= dt, and pay payPerSecond*dt.
//   3. Completion checked BEFORE deadline, so a job finishing the same tick its deadline
//      expires counts as a success.
//   4. Deadline miss: reputation penalty, unplace, destroy.
export function createWorkloadRunSystem(world: World, facility: EntityId): System {
  return {
    update(deltaSeconds: number) {
      const wallet = world.getComponent(wallets, facility);
      const reputation = world.getComponent(reputations, facility);
      const clock = world.getComponent(demandClocks, facility);
      if (!wallet || !reputation || !clock) return;

      for (const workloadId of world.query(workloads)) {
        const workload = world.getComponent(workloads, workloadId)!;

        workload.deadlineRemainingSeconds -= deltaSeconds;

        const placement = world.getComponent(placedOns, workloadId);
        const server = placement && world.getComponent(powereds, placement.serverId);
        if (placement && server?.online) {
          wallet.money += workload.payPerSecond * deltaSeconds;
          workload.workRemainingSeconds -= deltaSeconds;
        }

        if (workload.workRemainingSeconds <= 0) {
          reputation.value = clampReputation(reputation.value + REPUTATION_ON_COMPLETION);
          clock.contractsServed += 1;
          // D1: one workload occupies exactly one server, so its own demands.cpu IS what it
          // was served with — no fold across machines needed.
          clock.peakComputeServed = Math.max(clock.peakComputeServed, workload.demands.cpu);
          world.removeComponent(placedOns, workloadId);
          world.destroyEntity(workloadId);
          continue;
        }

        if (workload.deadlineRemainingSeconds <= 0) {
          reputation.value = clampReputation(reputation.value + REPUTATION_ON_MISSED_DEADLINE);
          world.removeComponent(placedOns, workloadId);
          world.destroyEntity(workloadId);
        }
      }
    },
  };
}
