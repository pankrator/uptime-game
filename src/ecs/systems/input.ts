// Click/key arbitration only (.plans/input-router-refactor.md). A click or key can only mean one
// thing, so deciding WHICH system it belongs to has to live in one documented, ordered place —
// that's this file's whole job. It contains no gameplay logic of its own: every branch is either
// a precondition check (is a panel open, is build mode active — inherently cross-system
// knowledge, has to live somewhere neutral) or a single call into the system that owns that
// domain (build.ts for build mode, rack-panel.ts/shop.ts/job-panels.ts for their own panels,
// maintenance.ts for task cancel, tutorial.ts for banner actions). Panel hit-testing, maintenance
// start/cancel, and chip/tray drag all live next to the system that owns them (see
// docs/ecs-systems/input.md and rack-panel.ts's own header comment for the drag lifecycle).
import { type World, type EntityId } from '../world';
import {
  buildModes,
  BUILDABLES,
  maintenanceTasks,
  activeModals,
  tutorialProgresses,
  gridToWorld,
  worldToGrid,
} from '../components';
import { advanceTutorial, skipTutorial, isTutorialActionStep } from './tutorial';
import { isOffersModalOpen, isJobsModalOpen, handleOffersModalClick, handleJobsModalClick } from './job-panels';
import { cancelMaintenanceTask } from './maintenance';
import { activeModal } from '../modal';
import { moveControlledTo } from '../movement-commands';
import { closeShop, handleShopClick } from './shop';
import { type InputStateTracker } from '../../input-state';
import { type Renderer } from '../../rendering';
import { type Camera } from '../../camera';
import { type Audio } from '../../audio';
import { type EventBus } from '../event-bus';
import { type GameEvents } from '../game-events';
import {
  pointerInRect,
  pointerInHud,
  getMuteButtonRect,
  getRecenterButtonRect,
  getTutorialActionButtonRect,
  getTutorialSkipRect,
} from '../../ui/layout';
import { findRackAt, openOrPromoteRackPanel, handleRackPanelClick } from './rack-panel';
import { selectBuildable, handleBuildPanelClick, handleBuildModePlacement } from './build';
import { type System } from './system';

export function createInputSystem(
  world: World,
  inputState: InputStateTracker,
  renderer: Renderer,
  controlled: EntityId,
  facility: EntityId,
  camera: Camera,
  audio: Audio,
  events: EventBus<GameEvents>,
): System {
  return {
    update() {
      // Runs first in main.ts's updateSystems — every other system that reads inputState this
      // tick (rack-panel.ts's chip/tray drag) sees the snapshot advanced here.
      inputState.update();
      const state = inputState.getState();

      // Escape — closes whichever of shop/build-mode is active. Two different owners, so this
      // stays a precondition check + delegation, not a single handler either system could own.
      if (state.keysPressedSincePreviousFrame.has('Escape')) {
        if (activeModal(world, controlled) === 'shop') {
          closeShop(world, controlled);
        } else if (world.getComponent(buildModes, controlled)) {
          world.removeComponent(buildModes, controlled);
        }
      }

      // Build-mode hotkeys (1..N, one per BUILDABLES entry).
      for (let index = 0; index < BUILDABLES.length; index++) {
        if (!state.keysPressedSincePreviousFrame.has(String(index + 1))) continue;
        if (world.getComponent(maintenanceTasks, controlled)) continue;
        if (isOffersModalOpen(world, controlled) || isJobsModalOpen(world, controlled)) continue;
        selectBuildable(world, controlled, BUILDABLES[index]);
      }

      if (!state.wasClicked) return;
      const pointer = { x: state.mouseX, y: state.mouseY };

      // -1. Mute toggle — always reachable, checked before anything else can swallow the click
      // (an install task, build mode, or a full-screen panel should never block it).
      if (pointerInRect(pointer, getMuteButtonRect(renderer.width))) {
        audio.setMuted(!audio.isMuted());
        return;
      }

      // -0.95. Recenter camera — only reachable while manually panned away (see
      // .plans/mobile-touch-support.md D3); same always-reachable treatment as the mute button.
      if (camera.detached && pointerInRect(pointer, getRecenterButtonRect(renderer.width))) {
        camera.recenter();
        return;
      }

      // -0.5. Tutorial banner — always reachable, checked early like the mute button, since the
      // banner sits above every other panel (see hud.ts's drawTutorialBanner). Its own hit
      // targets are checked directly here; the banner is NOT part of pointerInHud's blocking
      // region below (see .plans/playtest-findings.md B1) — clicking anywhere else on it falls
      // through to the ordinary click chain, same as clicking empty floor.
      const tutorialProgress = world.getComponent(tutorialProgresses, facility);
      const tutorialBannerVisible = !!tutorialProgress && !tutorialProgress.skipped;
      if (tutorialProgress && tutorialBannerVisible) {
        if (
          isTutorialActionStep(tutorialProgress.stepId) &&
          pointerInRect(pointer, getTutorialActionButtonRect(renderer.width, renderer.height))
        ) {
          audio.play('uiClick');
          if (tutorialProgress.stepId === 'welcome') {
            advanceTutorial(world, facility);
          } else {
            skipTutorial(world, facility);
          }
          return;
        }
        if (
          !isTutorialActionStep(tutorialProgress.stepId) &&
          pointerInRect(pointer, getTutorialSkipRect(renderer.width, renderer.height))
        ) {
          audio.play('uiClick');
          skipTutorial(world, facility);
          return;
        }
      }

      if (pointerInHud(pointer, renderer.canvas)) return;

      // 0.7. Offers / Jobs panels — centered modals like the rack/shop panels below, toggled by
      // the 'o'/'j' keys (job-panels.ts) instead of docked HUD chrome. Mutually exclusive with
      // each other and with the rack/shop panels (../modal.ts's openModal — pressing O/J while a
      // rack/shop panel is open SWITCHES to the requested panel rather than being blocked), so
      // checking them here — ahead of everything below — is safe: at most one of these five
      // branches (offers, jobs, maintenance, rack, shop) is ever live at once.
      const modal = activeModal(world, controlled);
      if (modal === 'offers') {
        handleOffersModalClick(world, renderer, controlled, facility, pointer, audio);
        return;
      }
      if (modal === 'jobs') {
        handleJobsModalClick(world, renderer, controlled, pointer, audio);
        return;
      }

      // 1. Maintenance task (install/repair/decommission) in progress → any click cancels and
      // refunds whatever was taken up front (see cancelMaintenanceTask).
      if (world.getComponent(maintenanceTasks, controlled)) {
        cancelMaintenanceTask(world, facility, controlled);
        return;
      }

      // 1.5. Open rack panel. A dispatching-mode panel stays hidden (and non-interactive) until
      // the player arrives — see rack-panel.ts's arrival check and render.ts's early return — so
      // while still walking there, a click falls through to plain movement below (redirecting
      // the walk, same as clicking anywhere else always does) rather than being absorbed by a
      // panel that isn't even on screen yet. activeModal() applies exactly this same visibility
      // gate (see ../modal.ts).
      const openPanel = world.getComponent(activeModals, controlled);
      if (modal === 'rack') {
        handleRackPanelClick(world, renderer, controlled, facility, pointer, audio);
        return;
      }

      // 1.6. Shop panel — full-screen modal like the rack panel above; ordering here is
      // load-bearing for the same reason (both absorb every click while open). Opened/closed
      // purely by proximity (shop.ts), so there's no travel state to check here — just whether
      // it's currently open.
      if (modal === 'shop') {
        handleShopClick(world, renderer, controlled, facility, pointer, audio, events);
        return;
      }

      // 2. Build panel entry.
      if (handleBuildPanelClick(world, controlled, pointer, renderer.height)) return;

      // 3. Build mode active.
      const buildMode = world.getComponent(buildModes, controlled);
      if (buildMode) {
        handleBuildModePlacement(world, controlled, facility, camera, pointer, audio);
        return;
      }

      // 4. Rack click (no build mode): dispatch — open/promote its panel and walk there. See
      // rack-panel.ts's openOrPromoteRackPanel and D4.
      const worldPointer = camera.screenToWorld(pointer);
      const { gridX, gridY } = worldToGrid(worldPointer.x, worldPointer.y);
      const rackId = findRackAt(world, gridX, gridY);
      if (rackId !== null) {
        const shouldWalk = openOrPromoteRackPanel(world, controlled, rackId);
        if (shouldWalk) {
          moveControlledTo(world, controlled, facility, gridToWorld(gridX, gridY));
        }
        return;
      }

      // 5. Plain floor click: just move. Cancels any not-yet-arrived dispatching panel — the
      // player just redirected away from that rack, and leaving it pending would let the panel
      // pop open unexpectedly if they later happened to walk near that rack for some other
      // reason (openPanel here is guaranteed rack-kind and not-yet-arrived: every other kind,
      // and the arrived/viewing rack case, already returned above).
      if (openPanel?.kind === 'rack') {
        world.removeComponent(activeModals, controlled);
      }
      moveControlledTo(world, controlled, facility, worldPointer);
    },
  };
}
