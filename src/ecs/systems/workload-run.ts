import { type World, type EntityId } from '../world';
import {
  workloads,
  placedOns,
  powereds,
  wallets,
  reputations,
  demandClocks,
  utilizations,
  installedIns,
  temperatures,
} from '../components';
import { REPUTATION_ON_MISSED_DEADLINE, REPUTATION_ON_COMPLETION, WORKLOAD_ARCHETYPES } from '../game-data';
import { type Audio } from '../../audio';
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
export function createWorkloadRunSystem(world: World, facility: EntityId, audio: Audio): System {
  return {
    update(deltaSeconds: number) {
      const wallet = world.getComponent(wallets, facility);
      const reputation = world.getComponent(reputations, facility);
      const clock = world.getComponent(demandClocks, facility);
      const utilization = world.getComponent(utilizations, facility);
      if (!wallet || !reputation || !clock) return;

      // .plans/power-billing.md step 3: HUD net-rate cache, written here since this system
      // already iterates every workload and knows which are running on an online server.
      let revenuePerSecond = 0;

      for (const workloadId of world.query(workloads)) {
        const workload = world.getComponent(workloads, workloadId)!;

        workload.deadlineRemainingSeconds -= deltaSeconds;

        const placement = world.getComponent(placedOns, workloadId);
        const server = placement && world.getComponent(powereds, placement.serverId);
        if (placement && server?.online) {
          // .plans/thermal-and-cooling.md Step 5: a throttled server does its work more slowly
          // and earns proportionally less — the honest reading of "it is going slower". Slowing
          // work while still paying full rate would make throttling free.
          const rackId = world.getComponent(installedIns, placement.serverId)?.rackId;
          const factor =
            (rackId !== undefined
              ? world.getComponent(temperatures, rackId)?.throttleFactor
              : undefined) ?? 1;
          wallet.money += workload.payPerSecond * factor * deltaSeconds;
          workload.workRemainingSeconds -= deltaSeconds * factor;
          revenuePerSecond += workload.payPerSecond * factor;
        }

        if (workload.workRemainingSeconds <= 0) {
          reputation.value = clampReputation(reputation.value + REPUTATION_ON_COMPLETION);
          // D1: one workload occupies exactly one server, so its own demands.cpu IS what it
          // was served with — no fold across machines needed.
          clock.peakComputeServed = Math.max(clock.peakComputeServed, workload.demands.cpu);
          audio.play('contractCompleted');

          // .plans/contract-variety.md D2: a recurring workload resets and stays placed on the
          // same server instead of being destroyed. Only the FINAL cycle counts toward
          // contractsServed — counting every cycle would inflate that score relative to what it
          // means for a one-shot contract (see the plan's step-2 note).
          if (workload.repeatCount > 0) {
            workload.repeatCount -= 1;
            workload.workRemainingSeconds = workload.workSeconds;
            workload.deadlineRemainingSeconds = WORKLOAD_ARCHETYPES[workload.archetypeId].deadlineSeconds;
            continue;
          }

          clock.contractsServed += 1;
          world.removeComponent(placedOns, workloadId);
          world.destroyEntity(workloadId);
          continue;
        }

        if (workload.deadlineRemainingSeconds <= 0) {
          reputation.value = clampReputation(reputation.value + REPUTATION_ON_MISSED_DEADLINE);
          // D1: penalty applies only here — an ACCEPTED workload missing its deadline. An
          // expired OFFER never reaches this loop (it's destroyed by createOfferExpirySystem
          // before ever becoming a Workload), so a silent decline still costs nothing.
          wallet.money -= workload.penaltyOnMiss;
          world.removeComponent(placedOns, workloadId);
          world.destroyEntity(workloadId);
          audio.play('contractMissed');
        }
      }

      if (utilization) utilization.revenuePerSecond = revenuePerSecond;
    },
  };
}
