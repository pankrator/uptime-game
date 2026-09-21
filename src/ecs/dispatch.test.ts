import { describe, it, expect } from 'vitest';
import {
  checkPlacement,
  placeWorkload,
  unplaceWorkload,
  acceptOffer,
  declineOffer,
} from './dispatch';
import {
  offers,
  placedOns,
  powereds,
  reputations,
  serverCapacities,
  workloads,
  type Offer,
} from './components';
import { REPUTATION_ON_DECLINE } from './game-data';
import { createTestFacility, spawnOnlineServer, spawnRack, makeWorkload } from './test-helpers';
import type { World } from './world';

describe('checkPlacement', () => {
  it('returns null (fits) when the workload demand is within the server free capacity', () => {
    const { world } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic'); // cpu 8, ram 32, storage 1000
    const workloadId = makeWorkload(world, { demands: { cpu: 2, ramGb: 8, storageGb: 100 } });

    expect(checkPlacement(world, workloadId, serverId)).toBeNull();
  });

  it('returns exactly the blocking trait keys when the demand does not fit', () => {
    const { world } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic'); // cpu 8, ram 32, storage 1000
    const workloadId = makeWorkload(world, { demands: { cpu: 32, ramGb: 4, storageGb: 5000 } });

    expect(checkPlacement(world, workloadId, serverId)).toEqual(['cpu', 'storageGb']);
  });

  it('blocks on every trait when the server is offline, however small the demand', () => {
    const { world } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    world.getComponent(powereds, serverId)!.online = false;
    const workloadId = makeWorkload(world, { demands: { cpu: 1, ramGb: 1, storageGb: 1 } });

    expect(checkPlacement(world, workloadId, serverId)).toEqual(['cpu', 'ramGb', 'storageGb']);
  });
});

describe('placeWorkload / unplaceWorkload', () => {
  it('placing sets the workload running and links it to the server', () => {
    const { world } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    const workloadId = makeWorkload(world);

    expect(placeWorkload(world, workloadId, serverId)).toBe(true);
    expect(world.getComponent(placedOns, workloadId)).toEqual({ serverId });
  });

  it('placing on a second server moves it — a single call, no dangling placement on the first', () => {
    const { world } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverA = spawnOnlineServer(world, rackId, 'basic');
    const serverB = spawnOnlineServer(world, rackId, 'storage');
    const workloadId = makeWorkload(world);

    placeWorkload(world, workloadId, serverA);
    placeWorkload(world, workloadId, serverB);

    expect(world.getComponent(placedOns, workloadId)).toEqual({ serverId: serverB });
  });

  it('unplacing clears the link and returns the workload to accepted state', () => {
    const { world } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    const workloadId = makeWorkload(world);
    placeWorkload(world, workloadId, serverId);

    unplaceWorkload(world, workloadId);

    expect(world.getComponent(placedOns, workloadId)).toBeUndefined();
  });

  it('unplacing an already-unplaced workload is a safe no-op', () => {
    const { world } = createTestFacility();
    const workloadId = makeWorkload(world);
    expect(() => unplaceWorkload(world, workloadId)).not.toThrow();
  });
});

describe('acceptOffer', () => {
  function makeOffer(world: World, overrides: Partial<Offer> = {}): number {
    const id = world.createEntity();
    const offer: Offer = {
      archetypeId: 'web',
      demands: { cpu: 2, ramGb: 8, storageGb: 100 },
      workSeconds: 45,
      deadlineSeconds: 80,
      payPerSecond: 0.9,
      secondsRemaining: 12, // deliberately different from deadlineSeconds
      slot: 0,
      penaltyOnMiss: 20,
      repeatCount: 0,
      repeatTotal: 1,
      ...overrides,
    };
    world.addComponent(offers, id, offer);
    return id;
  }

  it('destroys the offer and creates an accepted, unplaced workload', () => {
    const { world } = createTestFacility();
    const offerId = makeOffer(world);

    const workloadId = acceptOffer(world, offerId);

    expect(world.getComponent(offers, offerId)).toBeUndefined();
    expect(world.getComponent(placedOns, workloadId)).toBeUndefined();
  });

  it("deadline starts from the offer's full deadlineSeconds, not its remaining offer-window time (D2)", () => {
    const { world } = createTestFacility();
    const offerId = makeOffer(world, { deadlineSeconds: 80, secondsRemaining: 3 });

    const workloadId = acceptOffer(world, offerId);

    expect(world.getComponent(workloads, workloadId)!.deadlineRemainingSeconds).toBe(80);
  });
});

describe('declineOffer', () => {
  it('destroys the offer and applies the flat reputation cost', () => {
    const { world, facility } = createTestFacility();
    const offerId = world.createEntity();
    world.addComponent(offers, offerId, {
      archetypeId: 'web',
      demands: { cpu: 1, ramGb: 1, storageGb: 1 },
      workSeconds: 10,
      deadlineSeconds: 20,
      payPerSecond: 1,
      secondsRemaining: 10,
      slot: 0,
      penaltyOnMiss: 5,
      repeatCount: 0,
      repeatTotal: 1,
    });
    const startingRep = world.getComponent(reputations, facility)!.value;

    declineOffer(world, facility, offerId);

    expect(world.getComponent(offers, offerId)).toBeUndefined();
    expect(world.getComponent(reputations, facility)!.value).toBe(
      startingRep + REPUTATION_ON_DECLINE,
    );
  });

  it('clamps reputation at 0 rather than going negative', () => {
    const { world, facility } = createTestFacility();
    world.getComponent(reputations, facility)!.value = 0;
    const offerId = world.createEntity();
    world.addComponent(offers, offerId, {
      archetypeId: 'web',
      demands: { cpu: 1, ramGb: 1, storageGb: 1 },
      workSeconds: 10,
      deadlineSeconds: 20,
      payPerSecond: 1,
      secondsRemaining: 10,
      slot: 0,
      penaltyOnMiss: 5,
      repeatCount: 0,
      repeatTotal: 1,
    });

    declineOffer(world, facility, offerId);

    expect(world.getComponent(reputations, facility)!.value).toBe(0);
  });
});

describe('checkPlacement within a single tick', () => {
  it('accounts for a placement made since the last capacity recompute', () => {
    const { world } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    // 8 CPU / 32 GB / 1000 GB, and ServerCapacity seeded as capacity.ts would leave it.
    const serverId = spawnOnlineServer(world, rackId, 'basic');

    const first = makeWorkload(world, { demands: { cpu: 8, ramGb: 32, storageGb: 1000 } });
    const second = makeWorkload(world, { demands: { cpu: 8, ramGb: 32, storageGb: 1000 } });

    expect(checkPlacement(world, first, serverId)).toBeNull();
    placeWorkload(world, first, serverId);

    // No capacity.ts tick in between — the cached ServerCapacity.free still reads full.
    expect(world.getComponent(serverCapacities, serverId)!.free.cpu).toBe(8);
    expect(checkPlacement(world, second, serverId)).not.toBeNull();
  });

  it('frees the space again when the first workload is unplaced', () => {
    const { world } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');

    const first = makeWorkload(world, { demands: { cpu: 8, ramGb: 32, storageGb: 1000 } });
    const second = makeWorkload(world, { demands: { cpu: 8, ramGb: 32, storageGb: 1000 } });

    placeWorkload(world, first, serverId);
    unplaceWorkload(world, first);
    expect(checkPlacement(world, second, serverId)).toBeNull();
  });
});
