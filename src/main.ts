import { createRenderer } from './rendering';
import { createInput } from './input';
import { createGameState } from './state';
import { createGameLoop } from './core';
import { createWorld, type EntityId } from './ecs/world';
import { createCamera } from './camera';
import { createInputSystem } from './ecs/systems/input';
import { createMaintenanceSystem } from './ecs/systems/maintenance';
import { createPathFollowSystem } from './ecs/systems/path-follow';
import { createMovementSystem } from './ecs/systems/movement';
import { createRackPanelSystem } from './ecs/systems/rack-panel';
import { createShopSystem } from './ecs/systems/shop';
import { createResourceSystem } from './ecs/systems/resource';
import { createCapacitySystem } from './ecs/systems/capacity';
import { createWorkloadSpawnSystem, createOfferExpirySystem } from './ecs/systems/workload-spawn';
import { createWorkloadRunSystem } from './ecs/systems/workload-run';
import { createThermalSystem } from './ecs/systems/thermal';
import { createWearSystem } from './ecs/systems/wear';
import { createRenderSystem } from './ecs/systems/render';
import { createHudSystem } from './ecs/systems/hud';
import { createCameraSystem } from './ecs/systems/camera';
import { createTutorialSystem, startTutorial } from './ecs/systems/tutorial';
import { spawnPlayer, spawnFacility, applyStressPreset } from './entities';
import { getRoomRect } from './ecs/room';
import { gridToWorld, playerTags, facilityTags } from './ecs/components';
import { showLanding, hideLanding } from './landing';
import { createAudio } from './audio';
import { createSaveManager, MANUAL_SLOT, type SaveManager } from './save/manager';
import { createLocalStorageSaveStorage } from './save/local-storage';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) {
  throw new Error('Canvas element #game not found');
}

const landingContainer = document.querySelector<HTMLElement>('#landing');
if (!landingContainer) {
  throw new Error('Landing element #landing not found');
}

// One SaveManager for the page's whole lifetime — the landing screen's "has a save?" check and
// runGame's load/quicksave path both go through it. See .plans/save-load.md D1: swapping in a
// backend later is replacing this one line, nothing downstream of it changes.
const saveManager = createSaveManager(createLocalStorageSaveStorage());

const hasSave = await saveManager.hasSave(MANUAL_SLOT);

showLanding(
  landingContainer,
  () => {
    hideLanding(landingContainer);
    canvas.hidden = false;
    void runGame(canvas, false, saveManager, false);
  },
  hasSave
    ? () => {
        hideLanding(landingContainer);
        canvas.hidden = false;
        void runGame(canvas, false, saveManager, true);
      }
    : undefined,
  import.meta.env.DEV
    ? () => {
        hideLanding(landingContainer);
        canvas.hidden = false;
        void runGame(canvas, true, saveManager, false);
      }
    : undefined,
);

async function runGame(
  canvas: HTMLCanvasElement,
  stressPreset: boolean,
  saveManager: SaveManager,
  loadSave: boolean,
): Promise<void> {
  const renderer = createRenderer(canvas);
  const input = createInput(canvas);
  const state = createGameState();
  const world = createWorld();
  const camera = createCamera(input);
  const audio = createAudio();

  let facility: EntityId | undefined;
  let player: EntityId | undefined;

  if (loadSave) {
    const loaded = await saveManager.load(world, MANUAL_SLOT);
    if (loaded) {
      facility = world.query(facilityTags)[0];
      player = world.query(playerTags)[0];
    }
    if (!loaded || facility === undefined || player === undefined) {
      // Corrupt/foreign save data (D6) — fall back to a fresh game rather than leaving the
      // player stuck on an error. hasSave() already checked the slot was non-empty, so this
      // path is only reached by a save that failed to parse/hydrate.
      console.warn('[save] continue failed — starting a new game instead');
    }
  }

  if (facility === undefined || player === undefined) {
    facility = spawnFacility(world);
    if (stressPreset) {
      // Must run before the room-center spawn point is computed below — it grows the room past
      // the default closet tier, and the racks it places sit inside that larger room.
      applyStressPreset(world, facility);
    }
    const room = getRoomRect(world, facility);
    const spawnPoint = gridToWorld(
      Math.floor((room.minGridX + room.maxGridX) / 2),
      Math.floor((room.minGridY + room.maxGridY) / 2),
    );
    player = spawnPlayer(world, spawnPoint);
    startTutorial(world, facility, spawnPoint);
  }

  // Quicksave — no in-game panel yet (see .plans/save-load.md D7/Non-goals; a Canvas-drawn
  // pause/save panel is a follow-up), but the manual save slot needs SOME way to be written
  // from inside a running game, or "Continue" on the landing screen never has anything to
  // load. Mirrors camera.ts's own direct `input.onKeyDown(' ', ...)` — a key bound straight at
  // the call site that owns it, not routed through ecs/systems/input.ts's click-priority chain.
  input.onKeyDown('F5', () => {
    void saveManager.save(world, MANUAL_SLOT).then(
      () => console.info('[save] game saved'),
      (err: unknown) => console.error('[save] failed to save', err),
    );
  });

  // ORDER IS LOAD-BEARING — see .plans/machines-and-racks.md, .plans/workload-economy.md,
  // .plans/workload-dispatch.md, and .plans/hardware-failure.md.
  // - maintenance (renamed from install-progress) runs before movement (detects arrival on last
  //   frame's position).
  // - resource runs before capacity/workload-run: it computes Powered.online, which both depend
  //   on. Running workload-run first would pay out for browned-out machines and the capacity
  //   wall would be cosmetic.
  // - resource runs after movement so a machine installed this frame is budgeted the same frame.
  // - rack-panel runs after movement (arrival detection needs this frame's position) and before
  //   capacity: it commits any PendingDrop on arrival via placeWorkload, which capacity.ts must
  //   see this same frame. It's also where the player's drag-and-drop dispatch actually places
  //   workloads (step 8 of workload-dispatch.md) — there is no auto-placer anymore; a workload
  //   sits in the tray, unplaced, until the player drags it onto a server.
  // - capacity runs AFTER resource (needs Powered.online) and BEFORE workload-run: running
  //   workload-run against stale free-capacity would pay out for placements a brownout already
  //   invalidated this frame.
  // - thermal runs AFTER capacity (needs this tick's RackLoad.heatKw) and BEFORE workload-run
  //   (which applies Temperature.throttleFactor to pay/progress). It also runs after resource so
  //   a machine already offline from a brownout doesn't also generate heat. resource.ts is the
  //   sole writer of Powered.online; thermal.ts may only force a rack's machines offline on trip
  //   (never force them online) and otherwise signals via the ThermalTrip marker, which
  //   resource.ts reads as a veto on bringing a tripped rack back online — see
  //   .plans/thermal-and-cooling.md D7.
  // - wear runs AFTER resource (wear only accrues while Powered.online, and a failure sets it
  //   false) and AFTER thermal (heat accelerates wear, so it needs this tick's Temperature) —
  //   see .plans/hardware-failure.md D3/Step 3. It runs BEFORE workload-run so a machine that
  //   fails this frame doesn't also get paid this frame. Like thermal's ThermalTrip, wear.ts is
  //   the sole writer of the Failed marker; resource.ts only reads it, as a third veto on
  //   Powered.online alongside brownout and thermal trip (D7 of this plan) — never force a
  //   failed machine back online anywhere but a completed repair (maintenance.ts).
  // - spawn runs before run so a contract's offer window starts the same frame it arrives.
  const updateSystems = [
    createInputSystem(world, input, renderer, player, facility, camera, audio),
    createMaintenanceSystem(world, player, facility, audio),
    createPathFollowSystem(world),
    createMovementSystem(world),
    createRackPanelSystem(world, input, renderer, player, camera),
    createShopSystem(world, player),
    createResourceSystem(world, facility, audio),
    createCapacitySystem(world, facility),
    createThermalSystem(world, facility, audio),
    createWearSystem(world, facility, audio),
    createWorkloadSpawnSystem(world, facility),
    createOfferExpirySystem(world),
    createWorkloadRunSystem(world, facility, audio),
    // Runs last: it only reads state (has a rack been placed, a machine installed, a workload
    // placed, ...) to advance the guided-tutorial step, so it needs every other system's
    // mutations for this frame to have already landed — no ordering dependency the other way.
    createTutorialSystem(world, player, facility),
  ];

  // Rendering runs on requestAnimationFrame, separate from the systems above: rAF pauses
  // while the tab is unfocused, but the simulation must keep advancing regardless (see
  // src/core/index.ts). Render/HUD systems only read state and draw, so they're safe to
  // pause without affecting gameplay.
  // Camera update goes first — it must update before the render systems read it this frame.
  const renderSystems = [
    createCameraSystem(world, renderer, input, player, camera),
    createRenderSystem(world, renderer, player, facility, camera, input),
    createHudSystem(world, renderer, facility, audio, camera),
  ];

  const loop = createGameLoop({ renderer, input, state, updateSystems, renderSystems });
  state.scene = 'playing';
  loop.start();
  audio.startMusic();
}
