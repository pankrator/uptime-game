import { type World, type EntityId } from '../world';
import { workloads, placedOns, wallets, reputations, demandClocks } from '../components';
import { REPUTATION_ON_EXPIRY, REPUTATION_ON_COMPLETION } from '../game-data';
import { type System } from './system';

function clampReputation(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function createWorkloadRunSystem(world: World, facility: EntityId): System {
  return {
    update(deltaSeconds: number) {
      const wallet = world.getComponent(wallets, facility);
      const reputation = world.getComponent(reputations, facility);
      const clock = world.getComponent(demandClocks, facility);
      if (!wallet || !reputation || !clock) return;

      for (const workloadId of world.query(workloads)) {
        const workload = world.getComponent(workloads, workloadId)!;

        if (workload.state === 'pending') {
          workload.graceRemainingSeconds -= deltaSeconds;
          if (workload.graceRemainingSeconds <= 0) {
            reputation.value = clampReputation(reputation.value + REPUTATION_ON_EXPIRY);
            world.removeComponent(placedOns, workloadId);
            world.destroyEntity(workloadId);
          }
          continue;
        }

        wallet.money += workload.payPerSecond * deltaSeconds;
        workload.elapsedSeconds += deltaSeconds;

        if (workload.elapsedSeconds >= workload.durationSeconds) {
          reputation.value = clampReputation(reputation.value + REPUTATION_ON_COMPLETION);
          clock.contractsServed += 1;
          // D1: one workload occupies exactly one server, so its own demands.cpu IS what it
          // was served with — no fold across machines needed (unlike the old many-to-one
          // Assignment model).
          clock.peakComputeServed = Math.max(clock.peakComputeServed, workload.demands.cpu);
          world.removeComponent(placedOns, workloadId);
          world.destroyEntity(workloadId);
        }
      }
    },
  };
}
