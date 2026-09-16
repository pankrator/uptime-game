import { type World, type EntityId } from '../world';
import {
  positions,
  moveTargets,
  pathFollows,
  gridPositions,
  gridToWorld,
  worldToGrid,
  buildModes,
  BUILDABLES,
  rackSlots,
  installedIns,
  maintenanceTasks,
  openRackPanels,
  dragStates,
  shopOpens,
  tutorialProgresses,
  wallets,
  conditions,
  faileds,
  machines,
  decommissionConfirms,
  type BuildableDef,
} from '../components';
import {
  advanceTutorial,
  skipTutorial,
  isTutorialActionStep,
  recordShopPurchase,
} from './tutorial';
import {
  isOffersModalOpen,
  isJobsModalOpen,
  handleOffersModalClick,
  handleJobsModalClick,
} from './job-panels';
import { repairCost, repairSeconds } from '../wear';
import {
  isWalkable,
  findPath,
  findNearestWalkableNeighbor,
  simplifyPathToPixels,
} from '../pathfinding';
import { getWalkableRegions } from '../world-map';
import {
  MACHINE_TIERS,
  DECOMMISSION_SECONDS,
  REPAIRABLE_WEAR_THRESHOLD,
  type MachineTierId,
  type PurchasableId,
} from '../game-data';
import { getRoomRect } from '../room';
import { takeFromInventory, addToInventory } from '../inventory';
import { buy, dismissShop, shopTab, shopCategories, shopCatalogForTab } from './shop';
import { type InputState } from '../../input';
import { spawnRack, spawnCoolingUnit } from '../../entities';
import { type Renderer } from '../../rendering';
import { type Camera } from '../../camera';
import { type Audio } from '../../audio';
import {
  getBuildPanelEntryRect,
  pointerInRect,
  pointerInHud,
  getRackPanelCloseButtonRect,
  getShopCloseButtonRect,
  getShopTabRect,
  getShopBuyButtonRect,
  getMuteButtonRect,
  getRecenterButtonRect,
  getTutorialActionButtonRect,
  getTutorialSkipRect,
  getServerRepairButtonRect,
  getServerDecommissionButtonRect,
} from '../../ui/layout';
import {
  findRackAt,
  serversOn,
  trayWorkloadIds,
  openOrPromoteRackPanel,
  closeRackPanel,
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

function findLowestFreeSlot(world: World, rackId: EntityId, capacity: number): number | null {
  const occupied = new Set<number>();
  for (const id of world.query(installedIns)) {
    const installedIn = world.getComponent(installedIns, id)!;
    if (installedIn.rackId === rackId) occupied.add(installedIn.slotIndex);
  }
  for (let slot = 0; slot < capacity; slot++) {
    if (!occupied.has(slot)) return slot;
  }
  return null;
}

// Exported for rack-panel.ts: walking to a clicked rack (an obstacle — see D4's dispatching
// open path) needs the identical obstacle-fallback pathfinding as walking to any other point,
// so it reuses this rather than a second, likely-diverging implementation.
export function moveControlledTo(
  world: World,
  controlled: EntityId,
  facility: EntityId,
  targetPixel: { x: number; y: number },
): void {
  const position = world.getComponent(positions, controlled);
  if (!position) return;

  const regions = getWalkableRegions(world, facility);
  const start = worldToGrid(position.x, position.y);
  const { gridX: targetGridX, gridY: targetGridY } = worldToGrid(targetPixel.x, targetPixel.y);

  const targetIsWalkable = isWalkable(world, regions, targetGridX, targetGridY);
  const goal = targetIsWalkable
    ? { gridX: targetGridX, gridY: targetGridY }
    : findNearestWalkableNeighbor(
        world,
        regions,
        { gridX: targetGridX, gridY: targetGridY },
        start,
      );

  if (!goal) return;

  const path = findPath(world, regions, start, goal);
  if (path === null) return;

  // Exact click point when it's reachable; otherwise the neighbor cell's center, since the
  // click landed on an obstacle and there's no exact point on it to walk to.
  const endPixel = targetIsWalkable ? targetPixel : gridToWorld(goal.gridX, goal.gridY);

  world.removeComponent(moveTargets, controlled);

  const simplified = simplifyPathToPixels(world, regions, position, path, endPixel);
  world.addComponent(pathFollows, controlled, { path: simplified, index: 0 });
}

// D7 (install)/D5 (repair): cancelling refunds whatever was taken up front — the item to
// INVENTORY for an install (it was bought at the shop and is still owned; only the install
// itself was abandoned) or the wear-scaled fee to the WALLET for a repair. A decommission has
// nothing to refund: its payout only happens on completion (maintenance.ts), never up front.
function cancelMaintenanceTask(world: World, facility: EntityId, controlled: EntityId): void {
  const task = world.getComponent(maintenanceTasks, controlled);
  if (!task) return;

  if (task.job.kind === 'install') {
    addToInventory(world, facility, `machine-${task.job.tierId}` as PurchasableId);
  } else if (task.job.kind === 'repair') {
    const wallet = world.getComponent(wallets, facility);
    if (wallet) wallet.money += task.job.cost;
  }

  world.removeComponent(maintenanceTasks, controlled);
  world.removeComponent(pathFollows, controlled);
  world.removeComponent(moveTargets, controlled);
}

function tryInstallIntoRack(
  world: World,
  controlled: EntityId,
  facility: EntityId,
  tierId: MachineTierId,
  gridX: number,
  gridY: number,
): void {
  const rackId = findRackAt(world, gridX, gridY);
  if (rackId === null) return;

  const slots = world.getComponent(rackSlots, rackId)!;
  const slotIndex = findLowestFreeSlot(world, rackId, slots.capacity);
  if (slotIndex === null) return;

  const tier = MACHINE_TIERS[tierId];
  if (!takeFromInventory(world, facility, `machine-${tierId}` as PurchasableId)) return;

  moveControlledTo(world, controlled, facility, gridToWorld(gridX, gridY));

  world.addComponent(maintenanceTasks, controlled, {
    rackId,
    job: { kind: 'install', tierId, slotIndex },
    secondsRemaining: tier.installSeconds,
    totalSeconds: tier.installSeconds,
    arrived: false,
  });
}

const DECOMMISSION_CONFIRM_WINDOW_MS = 3000;

// Repair/decommission both queue a MaintenanceTask exactly like install does — click from
// anywhere (viewing-mode panel included), then walk there, then the work happens. See
// .plans/hardware-failure.md D5 ("one task at a time," attached to the player) and Step 6.
function tryStartRepair(
  world: World,
  controlled: EntityId,
  facility: EntityId,
  serverId: EntityId,
): void {
  if (world.getComponent(maintenanceTasks, controlled)) return;

  const condition = world.getComponent(conditions, serverId);
  const machine = world.getComponent(machines, serverId);
  const installedIn = world.getComponent(installedIns, serverId);
  if (!condition || !machine || !installedIn) return;

  const grid = world.getComponent(gridPositions, installedIn.rackId);
  if (!grid) return;

  const tier = MACHINE_TIERS[machine.tierId];
  const cost = repairCost(tier.cost, condition.wear);
  const wallet = world.getComponent(wallets, facility);
  if (!wallet || Math.floor(wallet.money) < cost) return;
  wallet.money -= cost;

  const seconds = repairSeconds(condition.wear);
  moveControlledTo(world, controlled, facility, gridToWorld(grid.gridX, grid.gridY));
  world.addComponent(maintenanceTasks, controlled, {
    rackId: installedIn.rackId,
    job: { kind: 'repair', machineId: serverId, cost },
    secondsRemaining: seconds,
    totalSeconds: seconds,
    arrived: false,
  });
}

function tryStartDecommission(
  world: World,
  controlled: EntityId,
  facility: EntityId,
  serverId: EntityId,
): void {
  if (world.getComponent(maintenanceTasks, controlled)) return;

  const installedIn = world.getComponent(installedIns, serverId);
  if (!installedIn) return;
  const grid = world.getComponent(gridPositions, installedIn.rackId);
  if (!grid) return;

  moveControlledTo(world, controlled, facility, gridToWorld(grid.gridX, grid.gridY));
  world.addComponent(maintenanceTasks, controlled, {
    rackId: installedIn.rackId,
    job: { kind: 'decommission', machineId: serverId },
    secondsRemaining: DECOMMISSION_SECONDS,
    totalSeconds: DECOMMISSION_SECONDS,
    arrived: false,
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
    if (world.getComponent(shopOpens, controlled)) {
      world.removeComponent(shopOpens, controlled);
      dismissShop();
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
      // each other and with the rack/shop panels (job-panels.ts's otherModalBlocking / the two
      // panels' own closeJobPanels calls), so checking them here — ahead of everything below —
      // is safe: at most one of these five branches (offers, jobs, maintenance, rack, shop) is
      // ever live at once.
      if (isOffersModalOpen(world, controlled)) {
        handleOffersModalClick(world, renderer, controlled, facility, pointer, audio);
        return;
      }
      if (isJobsModalOpen(world, controlled)) {
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
      // absorbed by a panel that isn't even on screen yet.
      const openPanel = world.getComponent(openRackPanels, controlled);
      const panelVisible = openPanel && (openPanel.mode === 'viewing' || openPanel.arrived);
      if (panelVisible) {
        const serverIds = serversOn(world, openPanel.rackId);
        const serverCount = serverIds.length;
        const trayCount = trayWorkloadIds(world).length;
        const closeRect = getRackPanelCloseButtonRect(
          renderer.width,
          renderer.height,
          serverCount,
          trayCount,
        );
        // The panel is a full-screen modal (the floor behind it is dimmed), so every click
        // while it's visible is absorbed here — not just clicks landing inside its own rect —
        // except the close button and the repair/decommission buttons below.
        if (pointerInRect(pointer, closeRect)) {
          closeRackPanel(world, controlled);
          return;
        }

        // Repair/decommission (.plans/hardware-failure.md Step 6) — reachable from a viewing
        // panel too (no travel required to click; the resulting task does its own walk), same
        // as clicking a rack from the build panel while remote.
        for (let index = 0; index < serverIds.length; index++) {
          const serverId = serverIds[index];

          const condition = world.getComponent(conditions, serverId);
          const repairable =
            condition &&
            (condition.wear > REPAIRABLE_WEAR_THRESHOLD || world.getComponent(faileds, serverId));
          if (repairable) {
            const repairRect = getServerRepairButtonRect(
              index,
              renderer.width,
              renderer.height,
              serverCount,
              trayCount,
            );
            if (pointerInRect(pointer, repairRect)) {
              audio.play('uiClick');
              tryStartRepair(world, controlled, facility, serverId);
              return;
            }
          }

          const decommissionRect = getServerDecommissionButtonRect(
            index,
            renderer.width,
            renderer.height,
            serverCount,
            trayCount,
          );
          if (pointerInRect(pointer, decommissionRect)) {
            const confirm = world.getComponent(decommissionConfirms, controlled);
            if (
              confirm &&
              confirm.serverId === serverId &&
              performance.now() < confirm.expiresAtMs
            ) {
              audio.play('uiClick');
              world.removeComponent(decommissionConfirms, controlled);
              tryStartDecommission(world, controlled, facility, serverId);
            } else {
              world.addComponent(decommissionConfirms, controlled, {
                serverId,
                expiresAtMs: performance.now() + DECOMMISSION_CONFIRM_WINDOW_MS,
              });
            }
            return;
          }
        }

        return;
      }

      // 1.6. Shop panel — full-screen modal like the rack panel above; ordering here is
      // load-bearing for the same reason (both absorb every click while open). Opened/closed
      // purely by proximity (shop.ts), so there's no travel state to check here — just whether
      // it's currently open.
      if (world.getComponent(shopOpens, controlled)) {
        const rowCount = shopCatalogForTab(shopTab.current).length;
        const closeRect = getShopCloseButtonRect(renderer.width, renderer.height, rowCount);
        if (pointerInRect(pointer, closeRect)) {
          world.removeComponent(shopOpens, controlled);
          dismissShop();
          return;
        }

        const categories = shopCategories();
        for (let tabIndex = 0; tabIndex < categories.length; tabIndex++) {
          const tabRect = getShopTabRect(
            tabIndex,
            categories.length,
            renderer.width,
            renderer.height,
            rowCount,
          );
          if (pointerInRect(pointer, tabRect)) {
            shopTab.current = categories[tabIndex];
            return;
          }
        }

        const rows = shopCatalogForTab(shopTab.current);
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const buyRect = getShopBuyButtonRect(rowIndex, renderer.width, renderer.height, rowCount);
          if (pointerInRect(pointer, buyRect)) {
            audio.play('uiClick');
            if (buy(world, facility, rows[rowIndex].id)) {
              recordShopPurchase(world, facility);
            }
            return;
          }
        }

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
          tryInstallIntoRack(world, controlled, facility, tierId, gridX, gridY);
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
      // reason (openPanel here is guaranteed not-yet-arrived: the arrived/viewing case already
      // returned above at the panelVisible check).
      if (openPanel) {
        world.removeComponent(openRackPanels, controlled);
      }
      moveControlledTo(world, controlled, facility, worldPointer);
    },
  };
}
