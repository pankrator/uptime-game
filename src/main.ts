import { createRenderer } from './rendering';
import { createInputStateTracker } from './input-state';
import { createGameState } from './state';
import { createGameLoop } from './core';
import { createWorld, type EntityId } from './ecs/world';
import { createCamera } from './camera';
import { createSimulationSystems } from './ecs/pipeline';
import { spawnToast } from './ecs/systems/effects';
import { createRenderSystem } from './ecs/systems/render';
import { createHudSystem } from './ecs/systems/hud';
import { createCameraSystem } from './ecs/systems/camera';
import { startTutorial } from './ecs/systems/tutorial';
import { spawnPlayer, spawnFacility, applyStressPreset } from './entities';
import { getRoomRect } from './ecs/room';
import { gridToWorld, playerTags, facilityTags } from './ecs/components';
import { showLanding, hideLanding, type SaveSlotSummary } from './landing';
import { createAudio } from './audio';
import { createEventBus } from './ecs/event-bus';
import { type GameEvents } from './ecs/game-events';
import { wireAudioEvents } from './ecs/audio-events';
import { createFpsCounter } from './fps';
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
// runGame's load/quicksave path both go through it. Swapping in a backend later is replacing
// this one line, nothing downstream of it changes.
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
  const inputState = createInputStateTracker(canvas);
  const state = createGameState();
  const world = createWorld();
  const camera = createCamera();
  const audio = createAudio();
  const events = createEventBus<GameEvents>();
  wireAudioEvents(events, audio);
  const fps = createFpsCounter();

  let facility: EntityId | undefined;
  let player: EntityId | undefined;

  if (loadSave) {
    const loaded = await saveManager.load(world, slot);
    if (loaded) {
      facility = world.query(facilityTags)[0];
      player = world.query(playerTags)[0];
    }
    if (!loaded || facility === undefined || player === undefined) {
      // Corrupt/foreign save data — fall back to a fresh game rather than leaving the
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

  // Quicksave — no in-game panel yet (a Canvas-drawn pause/save panel is a follow-up), but the
  // slot this run started from needs SOME way to be
  // written from inside a running game, or "Continue" on that slot never has anything to load.
  // Always saves back to the SAME slot the run started in (`slot`, fixed for this runGame
  // call) — there's no in-game slot switcher, only the landing screen's picker chooses a slot.
  // Polled directly rather than routed through ecs/systems/input.ts's click-priority chain, same
  // as camera.ts's own Space handling — F5 never competes with anything that chain owns.
  // input-state/index.ts prevents F5's default browser refresh, so this is the only thing F5
  // does — the toast (effects.ts's spawnToast, already used for miss/warning banners) is the
  // player's only feedback that the save happened, in place of the page reload they'd otherwise
  // see. A plain object, not its own file — this is the only thing it does, no domain to name a
  // system after.
  const quicksaveSystem = {
    update() {
      if (!inputState.getState().keysPressedSincePreviousFrame.has('F5')) return;
      void saveManager.save(world, slot).then(
        () => spawnToast(world, `Game saved to ${slot}`, '#4caf50'),
        (err: unknown) => {
          console.error('[save] failed to save', err);
          spawnToast(world, 'Save failed — see console', '#e53935');
        },
      );
    },
  };

  // Order lives in ecs/pipeline.ts, shared with the headless harness in src/sim/ so the two
  // can never disagree about it. Quicksave is appended rather than threaded through the
  // pipeline: it belongs to this run's save slot, not to the simulation, and it has no
  // ordering dependency beyond running after input has advanced the inputState snapshot.
  const updateSystems = [
    ...createSimulationSystems({
      world,
      inputState,
      renderer,
      player,
      facility,
      camera,
      audio,
      events,
    }),
    quicksaveSystem,
  ];

  // Rendering runs on requestAnimationFrame, separate from the systems above: rAF pauses
  // while the tab is unfocused, but the simulation must keep advancing regardless (see
  // src/core/index.ts). Render/HUD systems only read state and draw, so they're safe to
  // pause without affecting gameplay.
  // Camera update goes first — it must update before the render systems read it this frame.
  const renderSystems = [
    createCameraSystem(world, renderer, inputState, player, camera),
    createRenderSystem(world, renderer, player, facility, camera, inputState),
    createHudSystem(world, renderer, player, facility, audio, camera, fps),
  ];

  const loop = createGameLoop({ renderer, state, updateSystems, renderSystems, fps });
  state.scene = 'playing';
  loop.start();
  audio.startMusic();
}
