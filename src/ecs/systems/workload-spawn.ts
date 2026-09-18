import { type World, type EntityId } from '../world';
import { demandClocks, reputations, offers, utilizations } from '../components';
import {
  WORKLOAD_ARCHETYPES,
  getArrivalInterval,
  getValueScale,
  MAX_OFFERS,
  type WorkloadArchetypeId,
} from '../game-data';
import { spawnOffer } from '../../entities';
import { type System } from './system';

// F14 (.plans/design-review.md): the weighting roll is a parameter, defaulted to Math.random(),
// following wear.ts's rollFailure — exported so a test can drive a specific archetype pick
// without stubbing a global.
export function pickArchetype(reputation: number, random: number = Math.random()): WorkloadArchetypeId {
  const eligible = Object.values(WORKLOAD_ARCHETYPES).filter(
    (archetype) => archetype.minReputation <= reputation,
  );

  // Weight toward the larger unlocked archetypes so unlocking one actually changes what
  // you see, rather than being a rare event.
  const totalWeight = eligible.reduce((sum, _, index) => sum + (1 + index), 0);
  let roll = random * totalWeight;
  for (let index = 0; index < eligible.length; index++) {
    roll -= 1 + index;
    if (roll <= 0) return eligible[index].id;
  }
  return eligible[eligible.length - 1].id;
}

// Spawns Offer entities (accept/decline, not yet live workloads), capped at MAX_OFFERS
// concurrent. Each offer ticks its own secondsRemaining independently (see
// createOfferExpirySystem below); this system only decides when a NEW offer arrives.
export function createWorkloadSpawnSystem(world: World, facility: EntityId): System {
  return {
    update(deltaSeconds: number) {
      const clock = world.getComponent(demandClocks, facility);
      const reputation = world.getComponent(reputations, facility);
      const utilization = world.getComponent(utilizations, facility);
      if (!clock || !reputation || !utilization) return;

      clock.elapsedSeconds += deltaSeconds;
      clock.nextArrivalInSeconds -= deltaSeconds;

      if (clock.nextArrivalInSeconds > 0) return;

      // At cap: the clock keeps running but spawning is suppressed, so a player who ignores
      // everything does not accumulate a backlog beyond MAX_OFFERS.
      if (world.query(offers).length >= MAX_OFFERS) {
        clock.nextArrivalInSeconds = getArrivalInterval(clock.elapsedSeconds, reputation.value);
        return;
      }

      const archetypeId = pickArchetype(reputation.value);
      // Facility-wide installed/online CPU, not peakComputeServed — see
      // .plans/compute-scale-fix.md D1. spawnOffer derives the separately-capped demand scale
      // from this same value (D2).
      const valueScale = getValueScale(clock.elapsedSeconds, utilization.traitsTotal.cpu);
      spawnOffer(world, archetypeId, valueScale);

      clock.nextArrivalInSeconds = getArrivalInterval(clock.elapsedSeconds, reputation.value);
    },
  };
}

// Ticks every open offer's countdown; at zero it auto-declines — destroyed directly, NOT via
// dispatch.ts's declineOffer, so REPUTATION_ON_DECLINE never applies here. An ignored offer is
// a silent decline: the player never made a choice, so per .plans/contract-variety.md D1 it
// costs nothing, unlike an explicit decline click.
export function createOfferExpirySystem(world: World): System {
  return {
    update(deltaSeconds: number) {
      for (const offerId of world.query(offers)) {
        const offer = world.getComponent(offers, offerId)!;
        offer.secondsRemaining -= deltaSeconds;
        if (offer.secondsRemaining <= 0) {
          world.destroyEntity(offerId);
        }
      }
    },
  };
}
