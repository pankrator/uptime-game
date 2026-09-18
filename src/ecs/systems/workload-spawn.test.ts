import { describe, it, expect } from 'vitest';
import { createWorkloadSpawnSystem, createOfferExpirySystem, pickArchetype } from './workload-spawn';
import { demandClocks, offers } from '../components';
import { MAX_OFFERS } from '../game-data';
import { spawnOffer } from '../../entities';
import { createTestFacility, runTicks } from '../test-helpers';

describe('workload spawn system', () => {
  it('spawns no offer before the arrival clock elapses', () => {
    const { world, facility } = createTestFacility();
    const clock = world.getComponent(demandClocks, facility)!;
    clock.nextArrivalInSeconds = 100;

    runTicks(createWorkloadSpawnSystem(world, facility), 1, 5);

    expect(world.query(offers)).toHaveLength(0);
  });

  it('spawns an offer once the arrival clock elapses', () => {
    const { world, facility } = createTestFacility();
    const clock = world.getComponent(demandClocks, facility)!;
    clock.nextArrivalInSeconds = 1;

    runTicks(createWorkloadSpawnSystem(world, facility), 1, 2);

    expect(world.query(offers).length).toBeGreaterThanOrEqual(1);
  });

  it('never exceeds MAX_OFFERS concurrent offers, however long the clock runs', () => {
    const { world, facility } = createTestFacility();
    const clock = world.getComponent(demandClocks, facility)!;
    clock.nextArrivalInSeconds = 0.01;

    runTicks(createWorkloadSpawnSystem(world, facility), 1, 200);

    expect(world.query(offers).length).toBeLessThanOrEqual(MAX_OFFERS);
  });

  it('assigns each concurrent offer a distinct slot in [0, MAX_OFFERS) (F6)', () => {
    const { world, facility } = createTestFacility();
    const clock = world.getComponent(demandClocks, facility)!;
    clock.nextArrivalInSeconds = 0.01;

    runTicks(createWorkloadSpawnSystem(world, facility), 1, 200);

    const slots = world.query(offers).map((id) => world.getComponent(offers, id)!.slot);
    expect(new Set(slots).size).toBe(slots.length);
    for (const slot of slots) {
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(MAX_OFFERS);
    }
  });
});

// F14 (.plans/design-review.md): pickArchetype's roll is now an injectable parameter, so these
// cases can pin an exact outcome instead of statistically sampling Math.random().
describe('pickArchetype', () => {
  it('always picks the only eligible archetype, whatever the roll', () => {
    // reputation 10: only web (minReputation 0) is unlocked.
    expect(pickArchetype(10, 0)).toBe('web');
    expect(pickArchetype(10, 0.999)).toBe('web');
  });

  it('weights toward the higher-index eligible archetype as the roll approaches 1', () => {
    // reputation 25: web (minReputation 0) and batch (minReputation 20) are both eligible,
    // weighted 1:2 in favor of batch.
    expect(pickArchetype(25, 0)).toBe('web');
    expect(pickArchetype(25, 0.99)).toBe('batch');
  });
});

describe('spawnOffer repeat count', () => {
  it('rolls the low end of the archetype repeat range at random=0', () => {
    const { world } = createTestFacility();
    const offerId = spawnOffer(world, 'web', 1, 0); // web's repeatRange is [0, 3]
    expect(world.getComponent(offers, offerId)!.repeatCount).toBe(0);
  });

  it('rolls the high end of the archetype repeat range as random approaches 1', () => {
    const { world } = createTestFacility();
    const offerId = spawnOffer(world, 'web', 1, 0.999);
    expect(world.getComponent(offers, offerId)!.repeatCount).toBe(3);
  });
});

describe('offer expiry system', () => {
  it('ticks down secondsRemaining and destroys the offer once it hits zero, no penalty applied', () => {
    const { world } = createTestFacility();
    const offerId = world.createEntity();
    world.addComponent(offers, offerId, {
      archetypeId: 'web',
      demands: { cpu: 1, ramGb: 1, storageGb: 1 },
      workSeconds: 10,
      deadlineSeconds: 20,
      payPerSecond: 1,
      secondsRemaining: 2,
      slot: 0,
      penaltyOnMiss: 5,
      repeatCount: 0,
      repeatTotal: 1,
    });

    runTicks(createOfferExpirySystem(world), 1, 1);
    expect(world.getComponent(offers, offerId)!.secondsRemaining).toBe(1);

    runTicks(createOfferExpirySystem(world), 1, 1);
    expect(world.getComponent(offers, offerId)).toBeUndefined();
  });
});
