import { type World, type EntityId } from './world';
import { type System } from './systems/system';
import { createInputSystem } from './systems/input';
import { createJobPanelsSystem } from './systems/job-panels';
import { createMaintenanceSystem } from './systems/maintenance';
import { createPathFollowSystem } from './systems/path-follow';
import { createMovementSystem } from './systems/movement';
import { createRackPanelSystem } from './systems/rack-panel';
import { createShopSystem } from './systems/shop';
import { createResourceSystem } from './systems/resource';
import { createCapacitySystem } from './systems/capacity';
import { createThermalSystem } from './systems/thermal';
import { createWearSystem } from './systems/wear';
import { createWorkloadSpawnSystem, createOfferExpirySystem } from './systems/workload-spawn';
import { createWorkloadRunSystem } from './systems/workload-run';
import { createEffectsSystem } from './systems/effects';
import { createTutorialSystem } from './systems/tutorial';
import { type InputStateTracker } from '../input-state';
import { type Renderer } from '../rendering';
import { type Camera } from '../camera';
import { type Audio } from '../audio';
import { type EventBus } from './event-bus';
import { type GameEvents } from './game-events';

export interface SimulationSystemDeps {
  world: World;
  inputState: InputStateTracker;
  renderer: Renderer;
  player: EntityId;
  facility: EntityId;
  camera: Camera;
  audio: Audio;
  events: EventBus<GameEvents>;
}

/**
 * The per-tick simulation systems, in the one order that is correct (see below). Everything
 * here runs whether or not the tab is visible; the render/HUD systems are assembled separately
 * in main.ts, since pausing those affects nothing but what's on screen.
 *
 * Both the running game (main.ts) and the headless harness (src/sim/) build their pipeline from
 * this function, so there is exactly one copy of the order to keep correct.
 *
 * ORDER IS LOAD-BEARING.
 * - maintenance runs before movement (detects arrival on last frame's position).
 * - resource runs before capacity/workload-run: it computes Powered.online, which both depend
 *   on. Running workload-run first would pay out for browned-out machines and the capacity
 *   wall would be cosmetic.
 * - resource runs after movement so a machine installed this frame is budgeted the same frame.
 * - rack-panel runs after movement (arrival detection needs this frame's position) and before
 *   capacity: it commits any PendingDrop on arrival via placeWorkload, which capacity.ts must
 *   see this same frame. It's also where the player's drag-and-drop dispatch actually places
 *   workloads — there is no auto-placer anymore; a workload sits in the tray, unplaced, until
 *   the player drags it onto a server.
 * - capacity runs AFTER resource (needs Powered.online) and BEFORE workload-run: running
 *   workload-run against stale free-capacity would pay out for placements a brownout already
 *   invalidated this frame.
 * - thermal runs AFTER capacity (needs this tick's RackLoad.heatKw) and BEFORE workload-run
 *   (which applies Temperature.throttleFactor to pay/progress). It also runs after resource so
 *   a machine already offline from a brownout doesn't also generate heat. resource.ts is the
 *   sole writer of Powered.online; thermal.ts may only force a rack's machines offline on trip
 *   (never force them online) and otherwise signals via the ThermalTrip marker, which
 *   resource.ts reads as a veto on bringing a tripped rack back online.
 * - wear runs AFTER resource (wear only accrues while Powered.online, and a failure sets it
 *   false) and AFTER thermal (heat accelerates wear, so it needs this tick's Temperature). It
 *   runs BEFORE workload-run so a machine that fails this frame doesn't also get paid this
 *   frame. Like thermal's ThermalTrip, wear.ts is the sole writer of the Failed marker;
 *   resource.ts only reads it, as a third veto on Powered.online alongside brownout and
 *   thermal trip — never force a failed machine back online anywhere but a completed repair
 *   (maintenance.ts).
 * - spawn runs before run so a contract's offer window starts the same frame it arrives.
 * - job-panels runs right after input: it's an input-reactive system in its own right (key
 *   toggles, wheel-scroll) but doesn't feed or depend on anything else this tick, so its exact
 *   position beyond "after input" isn't load-bearing.
 * - input must run first: it advances the shared inputState snapshot that rack-panel's drag
 *   and job-panels' key toggles both read this same tick.
 * - tutorial runs last: it only reads state to advance the guided-tutorial step, so it needs
 *   every other system's mutations for this frame to have already landed.
 */
export function createSimulationSystems({
  world,
  inputState,
  renderer,
  player,
  facility,
  camera,
  audio,
  events,
}: SimulationSystemDeps): System[] {
  return [
    createInputSystem(world, inputState, renderer, player, facility, camera, audio, events),
    createJobPanelsSystem(world, inputState, renderer, player),
    createMaintenanceSystem(world, player, facility, events),
    createPathFollowSystem(world),
    createMovementSystem(world),
    createRackPanelSystem(world, inputState, renderer, player, camera),
    createShopSystem(world, player),
    createResourceSystem(world, facility, events),
    createCapacitySystem(world, facility),
    createThermalSystem(world, facility, events),
    createWearSystem(world, facility, events),
    createWorkloadSpawnSystem(world, facility),
    createOfferExpirySystem(world),
    createWorkloadRunSystem(world, facility, events),
    createEffectsSystem(world),
    createTutorialSystem(world, player, facility, events),
  ];
}
