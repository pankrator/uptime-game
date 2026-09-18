// Gesture arbitration and build-mode placement. F7 (.plans/design-review.md) moved this
// module's other two jobs out: panel hit-testing now lives next to each panel it tests
// (rack-panel.ts's handleRackPanelClick, shop.ts's handleShopClick), and starting/cancelling a
// maintenance task now lives in maintenance.ts (the module that finishes one). What's left here
// is the single-consumer click/drag priority chain — see the comment on the drag lifecycle
// below for why one system must own both wasClicked() and wasReleased() — and placing a rack/
// CRAC/machine while in build mode.
import { type World, type EntityId } from '../world';
import {
  gridPositions,
  gridToWorld,
  worldToGrid,
  buildModes,
  BUILDABLES,
  maintenanceTasks,
  activeModals,
  dragStates,
  tutorialProgresses,
  type BuildableDef,
} from '../components';
import { advanceTutorial, skipTutorial, isTutorialActionStep } from './tutorial';
import { isOffersModalOpen, isJobsModalOpen, handleOffersModalClick, handleJobsModalClick } from './job-panels';
import { cancelMaintenanceTask, startInstall } from './maintenance';
import { activeModal } from '../modal';
import { moveControlledTo } from '../movement-commands';
import { type MachineTierId, type PurchasableId } from '../game-data';
import { getRoomRect } from '../room';
import { takeFromInventory } from '../inventory';
import { closeShop, handleShopClick } from './shop';
import { type InputState } from '../../input';
import { spawnRack, spawnCoolingUnit } from '../../entities';
import { type Renderer } from '../../rendering';
import { type Camera } from '../../camera';
import { type Audio } from '../../audio';
import {
  getBuildPanelEntryRect,
  pointerInRect,
  pointerInHud,
  getMuteButtonRect,
  getRecenterButtonRect,
  getTutorialActionButtonRect,
  getTutorialSkipRect,
} from '../../ui/layout';
import {
  findRackAt,
  openOrPromoteRackPanel,
  handleRackPanelClick,
  tryStartDrag,
  updateDrag,
  resolveDrop,
} from './rack-panel';
import { type System } from './system';

function hitTestPanel(point: { x: number; y: number }, canvasHeight: number): number | null {
  for (let index = 0; index < BUILDABLES.length; index++) {
    const rect = getBuildPanelEntryRect(index, canvasHeight);
    if (pointerInRect(point, rect)) {
      return index;
    }
  }
  return null;
}

function isGridCellOccupied(world: World, gridX: number, gridY: number): boolean {
  return world.query(gridPositions).some((id) => {
    const grid = world.getComponent(gridPositions, id)!;
    return grid.gridX === gridX && grid.gridY === gridY;
  });
}

function selectBuildable(world: World, controlled: EntityId, selected: BuildableDef): void {
  const buildMode = world.getComponent(buildModes, controlled);
  if (buildMode?.buildableId === selected.id) {
    world.removeComponent(buildModes, controlled);
  } else {
    world.addComponent(buildModes, controlled, { buildableId: selected.id });
  }
}

export function createInputSystem(
  world: World,
  input: InputState,
  renderer: Renderer,
  controlled: EntityId,
  facility: EntityId,
  camera: Camera,
  audio: Audio,
): System {
  input.onKeyDown('Escape', () => {
    if (activeModal(world, controlled) === 'shop') {
      closeShop(world, controlled);
      return;
    }
    if (world.getComponent(buildModes, controlled)) {
      world.removeComponent(buildModes, controlled);
    }
  });

  BUILDABLES.forEach((buildable, index) => {
    const key = String(index + 1);
    input.onKeyDown(key, () => {
      if (world.getComponent(maintenanceTasks, controlled)) return;
      if (isOffersModalOpen(world, controlled) || isJobsModalOpen(world, controlled)) return;
      selectBuildable(world, controlled, buildable);
    });
  });

  return {
    update() {
      // --- Drag lifecycle (step 8) — runs every frame, independent of wasClicked(), since a
      // drag spans multiple frames between mousedown and mouseup. Owned here (not in
      // rack-panel.ts) for the same single-consumer reason as the click chain below: a drag's
      // mouseup also fires the browser's synthetic `click` event (no built-in drag threshold),
      // so whichever system decides "was this a drag-release or a plain click" must be the one
      // place both wasReleased() and wasClicked() are read, or the two could disagree.
      if (input.wasPressed()) {
        const pressPoint = input.getPointerPosition();
        if (pressPoint) {
          tryStartDrag(world, renderer, controlled, pressPoint);
        }
      }

      // Re-read after the press check above: a press and release can land in the same frame
      // (a fast click), and tryStartDrag may have just created this — reading dragStates
      // before the press check would miss that and leave the drag stuck forever (started, but
      // never resolved since wasReleased() only fires once).
      if (world.getComponent(dragStates, controlled)) {
        const movePoint = input.getPointerPosition();
        if (movePoint) updateDrag(world, controlled, movePoint);
      }

      // wasReleased() fires on EVERY click, not just drags (mousedown -> mouseup -> click is
      // the sequence for an ordinary click too). Only treat this as drag territory — and
      // swallow the paired wasClicked() — if a drag was actually in progress; otherwise let
      // the click fall through to the normal chain below (movement, rack-open, build, etc.).
      const wasDragging = world.getComponent(dragStates, controlled) !== undefined;
      if (input.wasReleased()) {
        const releasePoint = input.getPointerPosition();
        if (wasDragging) {
          // Consume the paired click now so the chain below never sees it — dragging a chip a
          // few pixels and releasing should never also walk the player to that spot.
          input.wasClicked();
          if (releasePoint) {
            resolveDrop(world, renderer, controlled, releasePoint);
          }
          return;
        }
      }

      if (!input.wasClicked()) return;

      const pointer = input.getPointerPosition();
      if (!pointer) return;

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
      // checking them here — ahead of everything below — is safe: at most one of
      // these five branches (offers, jobs, maintenance, rack, shop) is ever live at once. The
      // accept-confirm gate (.plans/playtest-findings.md F3 — accepting a contract nothing can
      // currently serve needs a second click, same shape as DecommissionConfirm) lives inside
      // handleOffersModalClick now, since offer accept/decline buttons only exist inside this
      // modal.
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

      // 1.5. Open rack panel. A dispatching-mode panel stays hidden (and non-interactive)
      // until the player arrives — see rack-panel.ts's arrival check and render.ts's early
      // return — so while still walking there, a click falls through to plain movement below
      // (redirecting the walk, same as clicking anywhere else always does) rather than being
      // absorbed by a panel that isn't even on screen yet. activeModal() applies exactly this
      // same visibility gate (see ../modal.ts).
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
        handleShopClick(world, renderer, controlled, facility, pointer, audio);
        return;
      }

      const panelIndex = hitTestPanel(pointer, renderer.height);
      const buildMode = world.getComponent(buildModes, controlled);

      // 2. Panel hit.
      if (panelIndex !== null) {
        selectBuildable(world, controlled, BUILDABLES[panelIndex]);
        return;
      }

      // 3. Build mode active.
      if (buildMode) {
        const buildable = BUILDABLES.find((b) => b.id === buildMode.buildableId)!;
        const worldPoint = camera.screenToWorld(pointer);
        const { gridX, gridY } = worldToGrid(worldPoint.x, worldPoint.y);

        if (buildable.placement === 'empty-cell') {
          const room = getRoomRect(world, facility);
          const insideRoom =
            gridX >= room.minGridX &&
            gridX <= room.maxGridX &&
            gridY >= room.minGridY &&
            gridY <= room.maxGridY;
          if (!insideRoom) return;
          if (isGridCellOccupied(world, gridX, gridY)) return;
          if (!takeFromInventory(world, facility, buildable.id as PurchasableId)) return;

          if (buildable.id === 'crac') {
            spawnCoolingUnit(world, gridX, gridY);
          } else {
            spawnRack(world, gridX, gridY);
          }
          audio.play('rackPlaced');
          // Stay in build mode so a row of the same buildable can be laid out quickly.
          return;
        }

        if (buildable.placement === 'rack') {
          // buildable.id is `machine-${MachineTierId}` for every rack-placement buildable —
          // strip the prefix rather than hand-matching each tier id (see BUILDABLES in
          // components.ts, generated from MACHINE_TIERS).
          const tierId = buildable.id.slice('machine-'.length) as MachineTierId;
          const rackId = findRackAt(world, gridX, gridY);
          if (rackId !== null) {
            startInstall(world, controlled, facility, tierId, rackId);
          }
          world.removeComponent(buildModes, controlled);
          return;
        }

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
