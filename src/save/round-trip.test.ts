import { describe, expect, it } from 'vitest';
import { createWorld, resetAllComponentStores } from '../ecs/world';
import { spawnPlayer, spawnFacility, spawnRack, spawnMachine, spawnOffer } from '../entities';
import { acceptOffer, placeWorkload } from '../ecs/dispatch';
import {
  positions,
  wallets,
  machines,
  installedIns,
  rackSlots,
  workloads,
  placedOns,
  playerTags,
  facilityTags,
} from '../ecs/components';
import { serializeWorld } from './serialize';
import { deserializeWorld } from './deserialize';

// Per-test isolation (one test's entities never leaking into the next's) is already handled
// globally by src/test/setup.ts's beforeEach — no per-file reset needed here.

describe('serializeWorld / deserializeWorld round trip', () => {
  it('restores a facility, a rack, an installed machine, and a running workload with references intact', () => {
    const world = createWorld();
    spawnPlayer(world, { x: 120, y: 80 });
    const facility = spawnFacility(world);
    const rack = spawnRack(world, 3, 4);
    const machine = spawnMachine(world, rack, 'basic', 0);
    const offer = spawnOffer(world, 'web', 1);
    const workload = acceptOffer(world, offer);
    placeWorkload(world, workload, machine);

    // A distinctive value so the assertions below actually verify the round trip carried real
    // data, not just that some default made it through.
    world.getComponent(wallets, facility)!.money = 4321;

    const envelope = serializeWorld(world);

    // Simulates a fresh page load: `world` is only ever read via `envelope` from here on,
    // never touched directly again, and its underlying (shared — see world.ts's createWorld
    // comment) component storage is reset before a second World reuses it, same as a real load
    // does (the browser tab has touched these stores exactly zero times before a load runs).
    resetAllComponentStores();
    const loaded = createWorld();
    deserializeWorld(envelope, loaded);

    const loadedPlayer = loaded.query(playerTags)[0];
    const loadedFacility = loaded.query(facilityTags)[0];
    expect(loadedPlayer).toBeDefined();
    expect(loadedFacility).toBeDefined();
    expect(loaded.getComponent(positions, loadedPlayer)).toEqual({ x: 120, y: 80 });
    expect(loaded.getComponent(wallets, loadedFacility)?.money).toBe(4321);

    const loadedRacks = loaded.query(rackSlots);
    expect(loadedRacks).toHaveLength(1);
    const [loadedRack] = loadedRacks;

    const loadedMachines = loaded.query(machines);
    expect(loadedMachines).toHaveLength(1);
    const [loadedMachine] = loadedMachines;
    // The whole point of D3's index-based remapping: InstalledIn.rackId must point at the
    // NEWLY created rack entity, not the old (and now meaningless) live id.
    expect(loaded.getComponent(installedIns, loadedMachine)).toEqual({
      rackId: loadedRack,
      slotIndex: 0,
    });

    const loadedWorkloads = loaded.query(workloads);
    expect(loadedWorkloads).toHaveLength(1);
    const [loadedWorkload] = loadedWorkloads;
    expect(loaded.getComponent(placedOns, loadedWorkload)).toEqual({ serverId: loadedMachine });
    expect(loaded.getComponent(workloads, loadedWorkload)?.state).toBe('running');
  });

  it('round-trips an empty world without error', () => {
    const world = createWorld();
    const envelope = serializeWorld(world);
    expect(envelope.entities).toEqual([]);

    const loaded = createWorld();
    expect(() => deserializeWorld(envelope, loaded)).not.toThrow();
  });
});
