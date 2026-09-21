// A running game with no browser attached: the same world, the same entities and the same
// system pipeline main.ts builds, advanced by hand instead of by a timer.
//
// Only one Simulation can be live at a time — createWorld() resets the module-level component
// stores (see ecs/world.ts), so creating a second one invalidates the first.
import { createWorld, type World, type EntityId } from '../ecs/world';
import { createSimulationSystems } from '../ecs/pipeline';
import { createEventBus, type EventBus } from '../ecs/event-bus';
import { type GameEvents } from '../ecs/game-events';
import { type System } from '../ecs/systems/system';
import { spawnPlayer, spawnFacility, applyStressPreset } from '../entities';
import { getRoomRect } from '../ecs/room';
import { gridToWorld } from '../ecs/components';
import { startTutorial } from '../ecs/systems/tutorial';
import { UPDATE_HZ } from '../core';
import { headlessRenderer, headlessCamera, headlessInput, headlessAudio } from './headless';
import { type Renderer } from '../rendering';
import { type Camera } from '../camera';

// Matches the live game's tick rate, so anything tuned against a simulated second behaves the
// same way against a real one.
export const SIMULATION_TICK_SECONDS = 1 / UPDATE_HZ;

export type GameEventName = keyof GameEvents;

const COUNTED_EVENTS: GameEventName[] = [
  'machine:installed',
  'machine:repaired',
  'machine:decommissioned',
  'machine:failed',
  'machine:browned-out',
  'machine:thermal-tripped',
  'contract:completed',
  'contract:missed',
  'shop:purchased',
];

export interface SimulationOptions {
  // Starts the guided tutorial, as a fresh game does. Off by default: the tutorial only drives
  // an overlay, and leaving it out keeps a run's state to what gameplay produced.
  tutorial?: boolean;
  // Starts from entities.ts's built-out facility instead of a fresh one.
  stressPreset?: boolean;
  canvasWidth?: number;
  canvasHeight?: number;
}

export interface Simulation {
  readonly world: World;
  readonly facility: EntityId;
  readonly player: EntityId;
  readonly events: EventBus<GameEvents>;
  readonly renderer: Renderer;
  readonly camera: Camera;
  // Simulated seconds advanced so far — independent of wall clock.
  readonly elapsedSeconds: number;
  // How many times each GameEvents event has fired since the run started.
  readonly eventCounts: ReadonlyMap<GameEventName, number>;
  // Advances every system once.
  tick(deltaSeconds?: number): void;
  // Advances `seconds` of simulated time. `driver` runs before each tick, which is where a
  // scripted player acts (see player.ts); `onTick` runs after, for sampling.
  run(
    seconds: number,
    options?: { driver?: System; onTick?: (sim: Simulation) => void; deltaSeconds?: number },
  ): void;
}

/**
 * Replaces Math.random with a seeded PRNG for the duration of `body`, restoring it afterwards
 * even if `body` throws. The systems that roll dice (workload-spawn.ts's archetype pick,
 * entities.ts's repeat-count roll, wear.ts's failure roll) all take their random value as a
 * defaulted parameter and are called with the default, so seeding the global is what makes a
 * whole run reproducible.
 */
export function withSeededRandom<T>(seed: number, body: () => T): T {
  const original = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return body();
  } finally {
    Math.random = original;
  }
}

export function createSimulation(options: SimulationOptions = {}): Simulation {
  const world = createWorld();
  const events = createEventBus<GameEvents>();
  const facility = spawnFacility(world);
  if (options.stressPreset) applyStressPreset(world, facility);

  const room = getRoomRect(world, facility);
  const spawnPoint = gridToWorld(
    Math.floor((room.minGridX + room.maxGridX) / 2),
    Math.floor((room.minGridY + room.maxGridY) / 2),
  );
  const player = spawnPlayer(world, spawnPoint);
  if (options.tutorial) startTutorial(world, facility, spawnPoint);

  const renderer = headlessRenderer(options.canvasWidth, options.canvasHeight);
  const camera = headlessCamera();
  const inputState = headlessInput();
  const audio = headlessAudio();

  const eventCounts = new Map<GameEventName, number>();
  for (const name of COUNTED_EVENTS) {
    events.on(name, () => eventCounts.set(name, (eventCounts.get(name) ?? 0) + 1));
  }

  const systems = createSimulationSystems({
    world,
    inputState,
    renderer,
    player,
    facility,
    camera,
    audio,
    events,
  });

  let elapsedSeconds = 0;

  const simulation: Simulation = {
    world,
    facility,
    player,
    events,
    renderer,
    camera,
    get elapsedSeconds() {
      return elapsedSeconds;
    },
    eventCounts,
    tick(deltaSeconds = SIMULATION_TICK_SECONDS) {
      for (const system of systems) system.update(deltaSeconds);
      elapsedSeconds += deltaSeconds;
    },
    run(seconds, { driver, onTick, deltaSeconds = SIMULATION_TICK_SECONDS } = {}) {
      const ticks = Math.round(seconds / deltaSeconds);
      for (let i = 0; i < ticks; i++) {
        driver?.update(deltaSeconds);
        simulation.tick(deltaSeconds);
        onTick?.(simulation);
      }
    },
  };

  return simulation;
}
