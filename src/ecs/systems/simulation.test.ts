// A headless, multi-system sustained run — the automated version of a manual tuning pass by eye
// (reputation stays in range, offers stay capped, no negative free capacity). No canvas, no
// dev server: just calling each system's update() in the same order main.ts documents as
// load-bearing, for many simulated seconds, and asserting the invariants every tick.
import { describe, it, expect } from 'vitest';
import { createResourceSystem } from './resource';
import { createCapacitySystem } from './capacity';
import { createWorkloadSpawnSystem, createOfferExpirySystem } from './workload-spawn';
import { createWorkloadRunSystem } from './workload-run';
import { acceptOffer, checkPlacement, placeWorkload } from '../dispatch';
import { offers, reputations, serverCapacities } from '../components';
import { MAX_OFFERS, TRAIT_KEYS } from '../game-data';
import { createTestFacility, spawnOnlineServer, spawnRack, stubEventBus } from '../test-helpers';
import type { World, EntityId } from '../world';

// A stand-in for a player who accepts every offer and places it on the first server it fits.
// Not a real dispatch strategy — just enough traffic to exercise accept/place/complete/miss
// across a long run, including offers nothing on the floor can serve (left in the tray to
// eventually miss their deadline, same as an inattentive real player).
function autoDispatch(world: World, serverIds: EntityId[]): void {
  for (const offerId of world.query(offers)) {
    const workloadId = acceptOffer(world, offerId);
    for (const serverId of serverIds) {
      if (checkPlacement(world, workloadId, serverId) === null) {
        placeWorkload(world, workloadId, serverId);
        break;
      }
    }
  }
}

describe('sustained facility simulation', () => {
  it('over 5 simulated minutes: reputation stays in [0,100], offers stay capped at MAX_OFFERS, and no server free capacity goes negative', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverIds = [
      spawnOnlineServer(world, rackId, 'basic'),
      spawnOnlineServer(world, rackId, 'dense'),
      spawnOnlineServer(world, rackId, 'storage'),
      spawnOnlineServer(world, rackId, 'memory'),
    ];

    const events = stubEventBus();
    const resource = createResourceSystem(world, facility, events);
    const capacity = createCapacitySystem(world, facility);
    const spawn = createWorkloadSpawnSystem(world, facility);
    const expiry = createOfferExpirySystem(world);
    const run = createWorkloadRunSystem(world, facility, events);

    const dt = 1 / 30;
    const totalSeconds = 300;

    for (let t = 0; t < totalSeconds; t += dt) {
      resource.update(dt);
      capacity.update(dt);
      autoDispatch(world, serverIds);
      // Re-run so free capacity reflects this tick's own placements before payouts — stale free
      // capacity would let workload-run overcommit a server.
      capacity.update(dt);
      spawn.update(dt);
      expiry.update(dt);
      run.update(dt);

      const reputation = world.getComponent(reputations, facility)!.value;
      expect(reputation).toBeGreaterThanOrEqual(0);
      expect(reputation).toBeLessThanOrEqual(100);
      expect(world.query(offers).length).toBeLessThanOrEqual(MAX_OFFERS);

      for (const serverId of world.query(serverCapacities)) {
        const free = world.getComponent(serverCapacities, serverId)!.free;
        for (const key of TRAIT_KEYS) {
          expect(free[key]).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
