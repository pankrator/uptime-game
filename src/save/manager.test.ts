import { describe, expect, it } from 'vitest';
import { createWorld } from '../ecs/world';
import { spawnPlayer, spawnFacility, spawnRack, spawnMachine } from '../entities';
import { facilityTags, utilizations, wallets } from '../ecs/components';
import { createSaveManager } from './manager';
import { type SaveStorage } from './types';

// In-memory stand-in for createLocalStorageSaveStorage (local-storage.ts) — that one talks to
// `window.localStorage`, unavailable in this suite's Node test environment (vite.config.ts).
// SaveManager only ever calls through the SaveStorage interface, so this is a drop-in.
function createMemoryStorage(): SaveStorage {
  const data = new Map<string, string>();
  return {
    async write(slot, value) {
      data.set(slot, value);
    },
    async read(slot) {
      return data.get(slot) ?? null;
    },
    async list() {
      return [...data.keys()];
    },
    async remove(slot) {
      data.delete(slot);
    },
  };
}

describe('SaveManager.load', () => {
  // Regression test for a real bug: a loaded facility never got a Utilization component
  // (deliberately excluded from the save format as a derived cache — D4), and every system
  // that maintains it — resource.ts, capacity.ts, workload-spawn.ts, hud.ts, render.ts —
  // treats that absence as "not initialized yet" rather than "create it." The practical
  // symptom: after loading a save, the HUD top bar never draws (wallet/money look gone) and
  // no new offers ever spawn, silently, forever.
  it('leaves the loaded facility with a fresh Utilization component so dependent systems can tick', async () => {
    const manager = createSaveManager(createMemoryStorage());

    const savedWorld = createWorld();
    spawnPlayer(savedWorld, { x: 0, y: 0 });
    const facility = spawnFacility(savedWorld);
    const rack = spawnRack(savedWorld, 1, 1);
    spawnMachine(savedWorld, rack, 'basic', 0);
    savedWorld.getComponent(wallets, facility)!.money = 999;
    await manager.save(savedWorld, 'slot-1');

    const loadedWorld = createWorld();
    const loaded = await manager.load(loadedWorld, 'slot-1');
    expect(loaded).toBe(true);

    const loadedFacility = loadedWorld.query(facilityTags)[0];
    expect(loadedFacility).toBeDefined();

    // Wallet is persisted directly — sanity check the rest of the load still works normally,
    // this isn't papering over a bigger deserialization problem.
    expect(loadedWorld.getComponent(wallets, loadedFacility)?.money).toBe(999);

    // The actual regression check: Utilization must exist, and be freshly seeded (never saved,
    // so "zeroed" is the only correct state immediately after a load — resource.ts/capacity.ts
    // repopulate its real numbers on the very next tick).
    const utilization = loadedWorld.getComponent(utilizations, loadedFacility);
    expect(utilization).toBeDefined();
    expect(utilization?.powerDrawKw).toBe(0);
    expect(utilization?.revenuePerSecond).toBe(0);
  });

  it('returns false and adds nothing for an empty slot', async () => {
    const manager = createSaveManager(createMemoryStorage());
    const world = createWorld();
    expect(await manager.load(world, 'slot-1')).toBe(false);
    expect(world.query(facilityTags)).toHaveLength(0);
  });
});
