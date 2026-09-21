// Shared builders for system tests. `World` has no DOM/canvas dependency (see world.ts), so
// every helper here runs headless in Node — no dev server, no browser.
import { createWorld, type World, type EntityId } from './world';
import { spawnFacility, spawnRack, spawnMachine } from '../entities';
import { powereds, serverCapacities, workloads, type Workload } from './components';
import { MACHINE_TIERS, type MachineTierId } from './game-data';
import { createEventBus, type EventBus } from './event-bus';
import { type GameEvents } from './game-events';
import { type System } from './systems/system';

// The headless Renderer/Audio doubles live with the rest of the simulation harness (src/sim/),
// which needs the same ones; re-exported here under the names the existing tests already use.
export { headlessRenderer as stubRenderer, headlessAudio as stubAudio } from '../sim/headless';

export function createTestFacility(): { world: World; facility: EntityId } {
  const world = createWorld();
  const facility = spawnFacility(world);
  return { world, facility };
}

// Spawns a machine on the given rack, already online with capacity set from its tier —
// bypasses a resource.ts/capacity.ts tick so a placement test doesn't need the full system
// pipeline running just to get a server into a usable state.
export function spawnOnlineServer(world: World, rackId: EntityId, tierId: MachineTierId): EntityId {
  const serverId = spawnMachine(world, rackId, tierId, 0);
  const powered = world.getComponent(powereds, serverId)!;
  powered.online = true;
  const traits = MACHINE_TIERS[tierId].traits;
  world.addComponent(serverCapacities, serverId, { total: traits, free: { ...traits } });
  return serverId;
}

export { spawnRack };

// A workload entity built directly from field overrides, for tests that don't need to go
// through a full offer/accept cycle (dispatch.test.ts covers that cycle itself).
export function makeWorkload(world: World, overrides: Partial<Workload> = {}): EntityId {
  const id = world.createEntity();
  const workload: Workload = {
    archetypeId: 'web',
    demands: { cpu: 1, ramGb: 1, storageGb: 1 },
    workSeconds: 10,
    workRemainingSeconds: 10,
    payPerSecond: 1,
    deadlineRemainingSeconds: 10,
    state: 'accepted',
    penaltyOnMiss: 10,
    repeatCount: 0,
    repeatTotal: 1,
    ...overrides,
  };
  world.addComponent(workloads, id, workload);
  return id;
}

// A fresh, unwired GameEvents bus — systems under test take `events: EventBus<GameEvents>` and
// emit on a state transition instead of calling audio.play() directly (see game-events.ts);
// tests either ignore it (nothing subscribed, emit() is a no-op) or subscribe their own
// assertion handler to check the right event fired with the right payload. Unlike stubAudio(),
// this needs no stubbing — createEventBus() is already dependency-free — but the name matches
// the existing stubX() convention for this file's other test doubles.
export function stubEventBus(): EventBus<GameEvents> {
  return createEventBus<GameEvents>();
}

export function runTicks(system: System, deltaSeconds: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) system.update(deltaSeconds);
}
