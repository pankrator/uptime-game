import { type World, type EntityId } from '../world';
import { demandClocks, reputations } from '../components';
import {
  WORKLOAD_ARCHETYPES,
  getArrivalInterval,
  getComputeScale,
  type WorkloadArchetypeId,
} from '../game-data';
import { spawnWorkload } from '../../entities';
import { type System } from './system';

function pickArchetype(reputation: number): WorkloadArchetypeId {
  const eligible = Object.values(WORKLOAD_ARCHETYPES).filter(
    (archetype) => archetype.minReputation <= reputation,
  );

  // Weight toward the larger unlocked archetypes so unlocking one actually changes what
  // you see, rather than being a rare event.
  const totalWeight = eligible.reduce((sum, _, index) => sum + (1 + index), 0);
  let roll = Math.random() * totalWeight;
  for (let index = 0; index < eligible.length; index++) {
    roll -= 1 + index;
    if (roll <= 0) return eligible[index].id;
  }
  return eligible[eligible.length - 1].id;
}

export function createWorkloadSpawnSystem(world: World, facility: EntityId): System {
  return {
    update(deltaSeconds: number) {
      const clock = world.getComponent(demandClocks, facility);
      const reputation = world.getComponent(reputations, facility);
      if (!clock || !reputation) return;

      clock.elapsedSeconds += deltaSeconds;
      clock.nextArrivalInSeconds -= deltaSeconds;

      if (clock.nextArrivalInSeconds > 0) return;

      const archetypeId = pickArchetype(reputation.value);
      const scale = getComputeScale(clock.elapsedSeconds, clock.peakComputeServed);
      spawnWorkload(world, archetypeId, scale);

      clock.nextArrivalInSeconds = getArrivalInterval(clock.elapsedSeconds, reputation.value);
    },
  };
}
