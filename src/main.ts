import { createRenderer } from './rendering';
import { createInput } from './input';
import { createGameState } from './state';
import { createGameLoop } from './core';
import { createWorld, type EntityId } from './ecs/world';
import { createCamera } from './camera';
import { createInputSystem } from './ecs/systems/input';
import { createJobPanelsSystem } from './ecs/systems/job-panels';
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
import { createEffectsSystem } from './ecs/systems/effects';
import { createRenderSystem } from './ecs/systems/render';
import { createHudSystem } from './ecs/systems/hud';
import { createCameraSystem } from './ecs/systems/camera';
import { createTutorialSystem, startTutorial } from './ecs/systems/tutorial';
import { spawnPlayer, spawnFacility, applyStressPreset } from './entities';
import { getRoomRect } from './ecs/room';
import { gridToWorld, playerTags, facilityTags } from './ecs/components';
import { showLanding, hideLanding, type SaveSlotSummary } from './landing';
import { createAudio } from './audio';
import { createSaveManager, SAVE_SLOT_IDS, DEV_SLOT, type SaveManager } from './save/manager';
import { createLocalStorageSaveStorage } from './save/local-storage';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) {
  throw new Error('Canvas element #game not found');
}

const landingContainer = document.querySelector<HTMLElement>('#landing');
if (!landingContainer) {
  throw new Error('Landing element #landing not found');
}

// One SaveManager for the page's whole lifetime — the landing screen's slot picker and
// runGame's load/quicksave path both go through it. See .plans/save-load.md D1: swapping in a
// backend later is replacing this one line, nothing downstream of it changes.
const saveManager = createSaveManager(createLocalStorageSaveStorage());

// Reads all 5 slots and renders the landing screen's slot picker. Called once at startup —
// there's currently no way back to the landing screen once a game starts (no in-game "quit to
// menu"), so there's nothing yet that would need this called a second time.
//
// `canvas`/`landingContainer` are passed in rather than closed over: both are narrowed to
// non-null above by the `if (!x) throw` guards, but that narrowing doesn't carry into a
// separately-declared function's body (only into a closure literal checked at its call site),
// so an explicit parameter is what actually gets them their non-null type here.
async function refreshLanding(
  canvas: HTMLCanvasElement,
  landingContainer: HTMLElement,
): Promise<void> {
  const infos = await saveManager.describeSlots(SAVE_SLOT_IDS);
  const slots: SaveSlotSummary[] = infos.map((info, index) => ({
    slot: info.slot,
    label: `Slot ${index + 1}`,
    occupied: info.occupied,
    savedAt: info.savedAt,
  }));

  showLanding(landingContainer, slots, {
    onNewGame: (slot) => {
      hideLanding(landingContainer);
      canvas.hidden = false;
      void runGame(canvas, false, saveManager, slot, false);
    },
    onContinue: (slot) => {
      hideLanding(landingContainer);
      canvas.hidden = false;
      void runGame(canvas, false, saveManager, slot, true);
    },
    onStartStress: import.meta.env.DEV
      ? () => {
          hideLanding(landingContainer);
          canvas.hidden = false;
          // Dev stress-preset runs live in their own reserved slot (DEV_SLOT), never one of
          // the 5 user-visible slots — so mashing this button while testing can never clobber
          // a real save.
          void runGame(canvas, true, saveManager, DEV_SLOT, false);
        }
      : undefined,
  });
}

await refreshLanding(canvas, landingContainer);

async function runGame(
  canvas: HTMLCanvasElement,
  stressPreset: boolean,
  saveManager: SaveManager,
  slot: string,
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
    const loaded = await saveManager.load(world, slot);
    if (loaded) {
      facility = world.query(facilityTags)[0];
      player = world.query(playerTags)[0];
    }
    if (!loaded || facility === undefined || player === undefined) {
      // Corrupt/foreign save data (D6) — fall back to a fresh game rather than leaving the
      // player stuck on an error. The landing screen only offers "Continue" on a slot
      // describeSlots() already found occupied, so this path is only reached by a save that
      // failed to parse/hydrate.
      console.warn(`[save] continue failed for "${slot}" — starting a new game instead`);
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
  // pause/save panel is a follow-up), but the slot this run started from needs SOME way to be
  // written from inside a running game, or "Continue" on that slot never has anything to load.
  // Always saves back to the SAME slot the run started in (`slot`, fixed for this runGame
  // call) — there's no in-game slot switcher, only the landing screen's picker chooses a slot.
  // Mirrors camera.ts's own direct `input.onKeyDown(' ', ...)` — a key bound straight at the
  // call site that owns it, not routed through ecs/systems/input.ts's click-priority chain.
  input.onKeyDown('F5', () => {
    void saveManager.save(world, slot).then(
      () => console.info(`[save] game saved to "${slot}"`),
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
  // - job-panels runs right after input: it's an input-reactive system in its own right (key
  //   toggles, wheel-scroll) but doesn't feed or depend on anything else this tick, so its exact
  //   position beyond "after input" isn't load-bearing — see .plans/job-panels.md.
  const updateSystems = [
    createInputSystem(world, input, renderer, player, facility, camera, audio),
    createJobPanelsSystem(world, input, renderer, player),
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
    // Expiry-only (floating text/toasts spawned by workload-run.ts above and resource.ts) — no
    // ordering dependency, since expiry is timestamp-based, not tick-based; placed here so it
    // reads naturally as "after the systems that spawn this frame's effects".
    createEffectsSystem(world),
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
    createHudSystem(world, renderer, player, facility, audio, camera),
  ];

  const loop = createGameLoop({ renderer, input, state, updateSystems, renderSystems });
  state.scene = 'playing';
  loop.start();
  audio.startMusic();
}
