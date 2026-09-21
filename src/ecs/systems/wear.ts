// Accrues per-machine wear and rolls for failure.
//
// Runs AFTER resource.ts (needs this tick's Powered.online — wear only accrues while online)
// and AFTER thermal.ts (needs this tick's rack Temperature — heat accelerates wear). See the
// ordering comment in main.ts.
import { type World, type EntityId } from '../world';
import { machines, installedIns, powereds, conditions, faileds, temperatures, demandClocks } from '../components';
import { heatWearMultiplier, wearGain, failureChancePerSecond, rollFailure } from '../wear';
import { evacuateForOutage } from './resource';
import { type EventBus } from '../event-bus';
import { type GameEvents } from '../game-events';
import { type System } from './system';

export function createWearSystem(world: World, facility: EntityId, events: EventBus<GameEvents>): System {
  return {
    update(deltaSeconds: number) {
      const elapsedSeconds = world.getComponent(demandClocks, facility)?.elapsedSeconds ?? 0;

      for (const machineId of world.query(machines, installedIns, conditions, powereds)) {
        const powered = world.getComponent(powereds, machineId)!;
        if (!powered.online) continue;

        if (world.getComponent(faileds, machineId)) continue;

        const condition = world.getComponent(conditions, machineId)!;
        const rackId = world.getComponent(installedIns, machineId)!.rackId;
        const celsius = world.getComponent(temperatures, rackId)?.celsius;
        const heatMultiplier = celsius !== undefined ? heatWearMultiplier(celsius) : 1;

        condition.wear = Math.min(1, condition.wear + wearGain(heatMultiplier, deltaSeconds));

        const chance = failureChancePerSecond(condition.wear);
        if (chance <= 0) continue;

        if (rollFailure(chance, deltaSeconds, Math.random())) {
          world.addComponent(faileds, machineId, { failedAt: elapsedSeconds });
          powered.online = false;
          powered.offlineCooldown = 0; // stays dead until repaired — no cooldown-based self-recovery
          evacuateForOutage(world, machineId);
          events.emit('machine:failed', { machineId });
        }
      }
    },
  };
}

// Exported for maintenance.ts's repair completion and resource.ts's Failed veto: neither this
// module nor the world's rules need it, but a lookup helper here keeps the failure vocabulary in
// one place next to where a machine actually breaks.
export function clearFailure(world: World, machineId: EntityId): void {
  world.removeComponent(faileds, machineId);
}
