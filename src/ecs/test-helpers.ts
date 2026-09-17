// Shared builders for Layer 3 (.plans/testing-strategy.md) system tests. `World` has no
// DOM/canvas dependency (see world.ts), so every helper here runs headless in Node — no dev
// server, no browser.
import { createWorld, type World, type EntityId } from './world';
import { spawnFacility, spawnRack, spawnMachine } from '../entities';
import { powereds, serverCapacities, workloads, type Workload } from './components';
import { MACHINE_TIERS, type MachineTierId } from './game-data';
import { type Audio } from '../audio';
import { type Renderer } from '../rendering';
import { type System } from './systems/system';

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

// No-op Audio — systems under test take `audio: Audio` and call `.play(name)` on state
// transitions; tests assert on component state, not on sound, so this just satisfies the type.
export function stubAudio(): Audio {
  return {
    play() {},
    setMuted() {},
    isMuted() {
      return false;
    },
    startMusic() {},
    stopMusic() {},
  };
}

export function runTicks(system: System, deltaSeconds: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) system.update(deltaSeconds);
}

// F7/F16: click-handling functions extracted from input.ts (handleRackPanelClick,
// handleShopClick) only read renderer.width/renderer.height — no canvas or drawing context —
// so a headless test can satisfy the Renderer interface with a stub rather than a real
// HTMLCanvasElement, which the "node" test environment (vite.config.ts) doesn't have.
export function stubRenderer(width: number, height: number): Renderer {
  return {
    canvas: null as unknown as HTMLCanvasElement,
    context: null as unknown as CanvasRenderingContext2D,
    width,
    height,
    clear() {},
  };
}
