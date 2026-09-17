import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWearSystem, clearFailure } from './wear';
import { placeWorkload } from '../dispatch';
import { conditions, faileds, placedOns, powereds } from '../components';
import { createTestFacility, spawnOnlineServer, spawnRack, makeWorkload, stubAudio, runTicks } from '../test-helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('wear system', () => {
  it('accrues wear on an online machine over time', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');

    runTicks(createWearSystem(world, facility, stubAudio()), 1, 60);

    expect(world.getComponent(conditions, serverId)!.wear).toBeGreaterThan(0);
  });

  it('never accrues wear on an offline machine (D1)', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    world.getComponent(powereds, serverId)!.online = false;

    runTicks(createWearSystem(world, facility, stubAudio()), 1, 60);

    expect(world.getComponent(conditions, serverId)!.wear).toBe(0);
  });

  it('rolling a failure marks the machine Failed, takes it offline, and unplaces its work', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    world.getComponent(conditions, serverId)!.wear = 0.999; // near-max, non-trivial failure chance
    const workloadId = makeWorkload(world);
    placeWorkload(world, workloadId, serverId);

    // Deterministic: a random draw of 0 is below any positive per-frame failure chance.
    vi.spyOn(Math, 'random').mockReturnValue(0);

    runTicks(createWearSystem(world, facility, stubAudio()), 1, 1);

    expect(world.getComponent(faileds, serverId)).toBeDefined();
    expect(world.getComponent(powereds, serverId)!.online).toBe(false);
    expect(world.getComponent(placedOns, workloadId)).toBeUndefined();
  });

  it('a failed machine stops accruing wear (nothing left to wear on a dead box)', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    world.addComponent(faileds, serverId, { failedAt: 0 });
    const wearBefore = world.getComponent(conditions, serverId)!.wear;

    runTicks(createWearSystem(world, facility, stubAudio()), 1, 60);

    expect(world.getComponent(conditions, serverId)!.wear).toBe(wearBefore);
  });
});

describe('clearFailure', () => {
  it('removes the Failed marker', () => {
    const { world } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    world.addComponent(faileds, serverId, { failedAt: 0 });

    clearFailure(world, serverId);

    expect(world.getComponent(faileds, serverId)).toBeUndefined();
  });
});
