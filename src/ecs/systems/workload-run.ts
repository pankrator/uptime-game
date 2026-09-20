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
  gridPositions,
  gridToWorld,
} from '../components';
import {
  REPUTATION_ON_MISSED_DEADLINE,
  REPUTATION_ON_COMPLETION,
  WORKLOAD_ARCHETYPES,
  clampReputation,
} from '../game-data';
import { spawnFloatingText, spawnToast } from './effects';
import { type EventBus } from '../event-bus';
import { type GameEvents } from '../game-events';
import { type System } from './system';

// A single finish deadline, not separate start/finish deadlines. Per workload, every tick:
//   1. deadlineRemainingSeconds -= dt, ALWAYS — whether sitting in the tray or running.
//   2. If placed and its server is online: workRemainingSeconds -= dt, and pay payPerSecond*dt.
//   3. Completion checked BEFORE deadline, so a job finishing the same tick its deadline
//      expires counts as a success.
//   4. Deadline miss: reputation penalty, unplace, destroy.
export function createWorkloadRunSystem(world: World, facility: EntityId, events: EventBus<GameEvents>): System {
  return {
    update(deltaSeconds: number) {
      const wallet = world.getComponent(wallets, facility);
      const reputation = world.getComponent(reputations, facility);
      const clock = world.getComponent(demandClocks, facility);
      const utilization = world.getComponent(utilizations, facility);
      if (!wallet || !reputation || !clock) return;

      // HUD net-rate cache, written here since this system already iterates every workload
      // and knows which are running on an online server.
      let revenuePerSecond = 0;

      for (const workloadId of world.query(workloads)) {
        const workload = world.getComponent(workloads, workloadId)!;

        workload.deadlineRemainingSeconds -= deltaSeconds;

        const placement = world.getComponent(placedOns, workloadId);
        const server = placement && world.getComponent(powereds, placement.serverId);
        if (placement && server?.online) {
          // A throttled server does its work more slowly and earns proportionally less — the
          // honest reading of "it is going slower". Slowing work while still paying full rate
          // would make throttling free.
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
          // One workload occupies exactly one server, so its own demands.cpu IS what it was
          // served with — no fold across machines needed.
          clock.peakComputeServed = Math.max(clock.peakComputeServed, workload.demands.cpu);
          events.emit('contract:completed', { workloadId });

          // `placement && server?.online` above is what got us here, so the rack this workload
          // just ran on is still valid to look up — do it before the placement is removed
          // further down (recurring cycles keep it placed; the final cycle removes it a few
          // lines below). Anchored at the RACK's grid position, not the server's own (no
          // separate Position component on a machine).
          if (placement) {
            const rackId = world.getComponent(installedIns, placement.serverId)?.rackId;
            const gridPos = rackId !== undefined ? world.getComponent(gridPositions, rackId) : undefined;
            if (gridPos) {
              const worldPos = gridToWorld(gridPos.gridX, gridPos.gridY);
              const earned = Math.round(workload.payPerSecond * workload.workSeconds);
              spawnFloatingText(world, worldPos.x, worldPos.y, `+$${earned}`, '#4caf50');
            }
          }

          // A recurring workload resets and stays placed on the same server instead of being
          // destroyed. Only the FINAL cycle counts toward contractsServed — counting every
          // cycle would inflate that score relative to what it means for a one-shot contract.
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
          // Penalty applies only here — an ACCEPTED workload missing its deadline. An expired
          // OFFER never reaches this loop (it's destroyed by createOfferExpirySystem before
          // ever becoming a Workload), so a silent decline still costs nothing.
          wallet.money -= workload.penaltyOnMiss;
          world.removeComponent(placedOns, workloadId);
          world.destroyEntity(workloadId);
          events.emit('contract:missed', { workloadId });
          // A red banner naming the actual cost, not just a beep.
          const label = WORKLOAD_ARCHETYPES[workload.archetypeId].label;
          spawnToast(
            world,
            `Missed deadline: ${label} — -$${workload.penaltyOnMiss}, ${REPUTATION_ON_MISSED_DEADLINE}★`,
            '#e53935',
          );
        }
      }

      if (utilization) utilization.revenuePerSecond = revenuePerSecond;
    },
  };
}
