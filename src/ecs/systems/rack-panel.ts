// Rack panel lifecycle: open/close, arrival detection, click hit-testing, and drag-and-drop.
//
// input.ts's click-priority chain still owns ordinary clicks (wasClicked) — calling this
// module's handleRackPanelClick once the panel is the active modal, same as before. Chip/tray
// drag is different: it's a gesture this module alone understands (hit-testing chips/tray cards
// is domain knowledge, not routing), so this module's own System owns the whole press/hold/
// release lifecycle directly (tryStartDrag/updateDrag/resolveDrop, called from its own update()
// below), independently of input.ts's click chain. This is safe without cross-system signaling
// because a rack panel is a full-screen modal that already absorbs every ordinary click while
// open — a drag's release also being seen as wasClicked is harmless, not double-handled, except
// at the panel's own excepted buttons (close/repair/decommission/the tray card's
// abandon-contract corner), which must not sit under a drag target (see tryStartDrag's own skip
// of the abandon-contract rect). This module's own System also owns: right-click (a separate,
// non-conflicting signal — the "view a rack" affordance), Escape (polled independently), and the
// per-frame arrival/pending-drop-commit/scroll logic.
import { type World, type EntityId } from '../world';
import {
  positions,
  gridPositions,
  gridToWorld,
  worldToGrid,
  rackSlots,
  machines,
  installedIns,
  activeModals,
  type ActiveModal,
  rackScrolls,
  dragStates,
  rejectedDrops,
  decommissionConfirms,
  conditions,
  faileds,
  placedOns,
  workloads,
  GRID_CELL_SIZE,
} from '../components';
import { type InputStateTracker } from '../../input-state';
import { type Camera } from '../../camera';
import { placeWorkload, checkPlacement, unplaceWorkload, abandonWorkload } from '../dispatch';
import { REPAIRABLE_WEAR_THRESHOLD } from '../game-data';
import { startRepair, startDecommission } from './maintenance';
import {
  getServerRowRect,
  getTrayCardRect,
  getTrayDropRect,
  getTrayCardDropButtonRect,
  getPlacedChipRect,
  getRackPanelContentRect,
  getRackPanelContentHeight,
  getRackPanelCloseButtonRect,
  getServerRepairButtonRect,
  getServerDecommissionButtonRect,
  pointerInRect,
} from '../../ui/layout';
import { maxScrollOffset } from '../../ui/scroll';
import { type Renderer } from '../../rendering';
import { type Audio } from '../../audio';
import { type System } from './system';
import { registerModalCloser, openModal } from '../modal';

const DECOMMISSION_CONFIRM_WINDOW_MS = 3000;

// This module's own slice of ActiveModal — narrowed once here so every function below can read
// `.rackId`/`.mode`/`.arrived` without repeating the discriminant check. Returns the SAME object
// the component store holds (no clone), so mutating a field through this (see
// createRackPanelSystem's arrival check) mutates the real component.
type RackModal = Extract<ActiveModal, { kind: 'rack' }>;

function rackModal(world: World, controlled: EntityId): RackModal | undefined {
  const modal = world.getComponent(activeModals, controlled);
  return modal?.kind === 'rack' ? modal : undefined;
}

// Same reach radius/approach as maintenance.ts's MAINTENANCE_REACH_PX — the established
// "close enough to interact with this rack" pattern.
export const DISPATCH_REACH_PX = GRID_CELL_SIZE * 1.2;

export function findRackAt(world: World, gridX: number, gridY: number): EntityId | null {
  for (const id of world.query(rackSlots, gridPositions)) {
    const grid = world.getComponent(gridPositions, id)!;
    if (grid.gridX === gridX && grid.gridY === gridY) return id;
  }
  return null;
}

// Server ids installed in a given rack, in slot order — the same grouping render.ts and
// capacity.ts each already do per-rack, just filtered to one rack instead of bucketing all of
// them (this module only ever needs one rack's servers at a time, for whichever panel is open).
export function serversOn(world: World, rackId: EntityId): EntityId[] {
  return world
    .query(machines, installedIns)
    .filter((id) => world.getComponent(installedIns, id)!.rackId === rackId)
    .sort(
      (a, b) =>
        world.getComponent(installedIns, a)!.slotIndex -
        world.getComponent(installedIns, b)!.slotIndex,
    );
}

// Accepted-but-unplaced workload ids — the tray's contents, same across every panel since the
// tray isn't rack-scoped.
export function trayWorkloadIds(world: World): EntityId[] {
  return world
    .query(workloads)
    .filter((id) => world.getComponent(workloads, id)!.state === 'accepted')
    .sort((a, b) => a - b);
}

// Safe to call whenever the active modal is actually 'rack' (every call site below either just
// confirmed that, or is the registered 'rack' closer — invoked by modal.ts's openModal only when
// the CURRENT active modal's kind is 'rack'). Unconditionally clearing activeModals here would
// be wrong if some OTHER modal were active; nothing calls this except in that guaranteed state.
export function closeRackPanel(world: World, controlled: EntityId): void {
  world.removeComponent(activeModals, controlled);
  world.removeComponent(rackScrolls, controlled);
  world.removeComponent(dragStates, controlled);
  world.removeComponent(rejectedDrops, controlled);
  world.removeComponent(decommissionConfirms, controlled);
}

registerModalCloser('rack', closeRackPanel);

// Highest legal scroll offset for the given content/viewport heights — 0 once content fits
// without scrolling. Shared by the wheel handler (clamping the new offset) and render.ts
// (nothing to draw beyond this, so it never needs to know about the clamp itself). Re-exported
// under this name for backward compatibility with render.ts's import; the formula itself now
// lives in ui/scroll.ts so the offers/jobs panels can reuse it too.
export const maxRackScroll = maxScrollOffset;

// Translates a screen-space pointer into the rack panel's unscrolled content space (the space
// getServerRowRect/getTrayCardRect/getPlacedChipRect lay out in) by adding back however far the
// content has scrolled. Returns null if the pointer isn't over the content viewport at all —
// scrolled-off content is clipped in render.ts and must not be hit-testable either.
function toContentSpace(
  world: World,
  controlled: EntityId,
  renderer: Renderer,
  rackId: EntityId,
  pointer: { x: number; y: number },
): { x: number; y: number } | null {
  const canvasWidth = renderer.width;
  const canvasHeight = renderer.height;
  const serverIds = serversOn(world, rackId);
  const trayIds = trayWorkloadIds(world);
  const contentRect = getRackPanelContentRect(
    canvasWidth,
    canvasHeight,
    serverIds.length,
    trayIds.length,
  );
  if (!pointerInRect(pointer, contentRect)) return null;

  const offsetPx = world.getComponent(rackScrolls, controlled)?.offsetPx ?? 0;
  return { x: pointer.x, y: pointer.y + offsetPx };
}

// Called from input.ts's click-priority chain when a rack was clicked in dispatch mode (the
// ordinary left-click — walks the player there). Handles opening a fresh panel, re-clicking
// the already-open one (no-op), and promoting an open viewing panel to dispatching: switching
// from a viewing panel to dispatching the same rack flips mode to 'dispatching' and starts the
// walk, with the panel staying open throughout. Returns true if a walk should start.
export function openOrPromoteRackPanel(
  world: World,
  controlled: EntityId,
  rackId: EntityId,
): boolean {
  const current = rackModal(world, controlled);

  if (current?.rackId === rackId) {
    if (current.mode === 'viewing') {
      current.mode = 'dispatching';
      current.arrived = false;
      return true;
    }
    return false; // already dispatching (or already arrived) at this rack — nothing to do
  }

  // Only one modal at a time (see ../modal.ts) — a rack click always wins over any other open
  // panel. openModal only runs a PREVIOUS modal's closer when it's a different kind, so opening
  // rack while a different rack's panel is already open doesn't tear it down first.
  openModal(world, controlled, { kind: 'rack', rackId, mode: 'dispatching', arrived: false });
  world.addComponent(rackScrolls, controlled, { offsetPx: 0 });
  return true;
}

// Panel hit-testing — this module owns the rack panel's layout (it already draws against the
// same rects in render.ts), so the click targets live next to it instead of input.ts importing
// nine layout getters to know their geometry. Called from input.ts's click-priority chain only
// once activeModal() (../modal.ts) is already 'rack' — the
// panel is a full-screen modal, so every click while it's visible is absorbed here, not just
// clicks landing inside its own rect, except the close button and the repair/decommission
// buttons.
export function handleRackPanelClick(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  facility: EntityId,
  pointer: { x: number; y: number },
  audio: Audio,
): void {
  const panel = rackModal(world, controlled)!;
  const serverIds = serversOn(world, panel.rackId);
  const serverCount = serverIds.length;
  const trayCount = trayWorkloadIds(world).length;
  const closeRect = getRackPanelCloseButtonRect(
    renderer.width,
    renderer.height,
    serverCount,
    trayCount,
  );

  if (pointerInRect(pointer, closeRect)) {
    closeRackPanel(world, controlled);
    return;
  }

  // Repair/decommission are reachable from a viewing panel too (no travel required to click;
  // the resulting task does its own walk), same as clicking a rack from the build panel while
  // remote.
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
        startRepair(world, controlled, facility, serverId);
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
      if (confirm && confirm.serverId === serverId && performance.now() < confirm.expiresAtMs) {
        audio.play('uiClick');
        world.removeComponent(decommissionConfirms, controlled);
        startDecommission(world, controlled, facility, serverId);
      } else {
        world.addComponent(decommissionConfirms, controlled, {
          serverId,
          expiresAtMs: performance.now() + DECOMMISSION_CONFIRM_WINDOW_MS,
        });
      }
      return;
    }
  }

  // Abandon-contract button on each tray card — immediate, no confirm: it's already strictly
  // better than letting the same contract rot into a full miss, so there's nothing a second
  // click needs to protect against.
  const trayIds = trayWorkloadIds(world);
  for (let index = 0; index < trayIds.length; index++) {
    const dropRect = getTrayCardDropButtonRect(
      index,
      renderer.width,
      renderer.height,
      serverCount,
      trayCount,
    );
    if (pointerInRect(pointer, dropRect)) {
      audio.play('uiClick');
      abandonWorkload(world, facility, trayIds[index]);
      return;
    }
  }
}

// --- Drag and drop (step 8) ---------------------------------------------------------------
//
// Only meaningful while a panel is open in 'dispatching' mode AND the player has arrived:
// render.ts draws nothing for a dispatching panel before arrival, so there is no geometry to
// press against, and viewing-mode rows render but are non-interactive.

// Workload ids placed on a given server, in the same order render.ts draws their chips.
export function placedWorkloadIds(world: World, serverId: EntityId): EntityId[] {
  return world
    .query(placedOns, workloads)
    .filter((id) => world.getComponent(placedOns, id)!.serverId === serverId)
    .sort((a, b) => a - b);
}

// mousedown hit-test + drag start, called from this module's own System.update().
// Returns true if a drag was started (a tray card or a placed chip was under the pointer).
export function tryStartDrag(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  pointer: { x: number; y: number },
): boolean {
  const panel = rackModal(world, controlled);
  // Dispatching-mode panels are invisible until arrived (render.ts's early return) — refuse to
  // start a drag against geometry that isn't actually on screen.
  if (!panel || panel.mode !== 'dispatching' || !panel.arrived) return false;

  // Scrolled-off content is clipped in render.ts and must not be draggable either — toContentSpace
  // returns null for a pointer outside the visible content viewport.
  const contentPoint = toContentSpace(world, controlled, renderer, panel.rackId, pointer);
  if (!contentPoint) return false;

  const canvasWidth = renderer.width;
  const canvasHeight = renderer.height;
  const serverIds = serversOn(world, panel.rackId);
  const trayIds = trayWorkloadIds(world);

  // Placed chips first (drag off a server), matching the z-order render.ts draws them in
  // (chips sit at each row's top-right, on top of the row background).
  for (let serverIndex = 0; serverIndex < serverIds.length; serverIndex++) {
    const serverId = serverIds[serverIndex];
    const placedIds = placedWorkloadIds(world, serverId);
    for (let chipIndex = 0; chipIndex < placedIds.length; chipIndex++) {
      const chip = getPlacedChipRect(
        serverIndex,
        chipIndex,
        canvasWidth,
        canvasHeight,
        serverIds.length,
        trayIds.length,
      );
      if (pointerInRect(contentPoint, chip)) {
        world.addComponent(dragStates, controlled, {
          workloadId: placedIds[chipIndex],
          pointer, // screen space — render.ts draws the dragged card at the raw cursor position
          origin: { serverId },
        });
        return true;
      }
    }
  }

  for (let trayIndex = 0; trayIndex < trayIds.length; trayIndex++) {
    const card = getTrayCardRect(
      trayIndex,
      canvasWidth,
      canvasHeight,
      serverIds.length,
      trayIds.length,
    );
    // The abandon-contract button (handleRackPanelClick above) overlays this card's corner — a
    // press there must fall through as a plain click, not start a drag, or its click handler
    // never sees it.
    const dropButton = getTrayCardDropButtonRect(
      trayIndex,
      canvasWidth,
      canvasHeight,
      serverIds.length,
      trayIds.length,
    );
    if (pointerInRect(contentPoint, dropButton)) continue;
    if (pointerInRect(contentPoint, card)) {
      world.addComponent(dragStates, controlled, {
        workloadId: trayIds[trayIndex],
        pointer,
        origin: 'tray',
      });
      return true;
    }
  }

  return false;
}

// mousemove while dragging — updates DragState.pointer so render.ts can draw the dragged card
// following the cursor. No-op if nothing is being dragged.
export function updateDrag(
  world: World,
  controlled: EntityId,
  pointer: { x: number; y: number },
): void {
  const drag = world.getComponent(dragStates, controlled);
  if (drag) drag.pointer = pointer;
}

// Which server row (if any) the pointer is over, within the currently open panel. `pointer` is
// already in content space (see toContentSpace) — callers convert once and pass the same point
// to both this and any tray-rect check, rather than converting twice.
function hitTestServerRow(
  world: World,
  renderer: Renderer,
  rackId: EntityId,
  pointer: { x: number; y: number },
): EntityId | null {
  const canvasWidth = renderer.width;
  const canvasHeight = renderer.height;
  const serverIds = serversOn(world, rackId);
  const trayIds = trayWorkloadIds(world);

  for (let index = 0; index < serverIds.length; index++) {
    const row = getServerRowRect(
      index,
      canvasWidth,
      canvasHeight,
      serverIds.length,
      trayIds.length,
    );
    if (pointerInRect(pointer, row)) return serverIds[index];
  }
  return null;
}

const REJECTED_DROP_FLASH_MS = 900;

// mouseup — called from this module's own System.update() whenever a drag was in
// progress (regardless of where the pointer ended up), clearing DragState unconditionally.
// Resolves the drop:
//   - dropped on the tray, dragged from a server → unplaced immediately. Removing load never
//     needs a fit-check and never depends on being physically present (the presence gate exists
//     to stop the player placing work they can't verify fits — it has nothing to check here),
//     so this is the one drop outcome that's never queued as a PendingDrop.
//   - not over any server row or the tray → cancelled, workload stays exactly where it was.
//   - over a server row that fits → placed.
//   - over a server row that doesn't fit → rejected; sets RejectedDrop so render.ts flashes the
//     blocking trait bars red for a moment, and the workload stays at its origin.
export function resolveDrop(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  pointer: { x: number; y: number },
): void {
  const drag = world.getComponent(dragStates, controlled);
  if (!drag) return;
  world.removeComponent(dragStates, controlled);

  const panel = rackModal(world, controlled);
  if (!panel) return; // panel closed mid-drag — nothing to resolve against
  // tryStartDrag only starts a drag against an arrived dispatching panel, but the panel is
  // re-read here, so state it rather than assume it.
  if (panel.mode !== 'dispatching' || !panel.arrived) return;

  // Dropped outside the visible content viewport (including scrolled-off content) — same as
  // dropping outside any row or the tray: cancelled, workload stays at its origin.
  const contentPoint = toContentSpace(world, controlled, renderer, panel.rackId, pointer);
  if (!contentPoint) return;

  const canvasWidth = renderer.width;
  const canvasHeight = renderer.height;
  const serverIds = serversOn(world, panel.rackId);
  const trayIds = trayWorkloadIds(world);

  if (typeof drag.origin === 'object') {
    const trayRect = getTrayDropRect(canvasWidth, canvasHeight, serverIds.length, trayIds.length);
    if (pointerInRect(contentPoint, trayRect)) {
      unplaceWorkload(world, drag.workloadId);
      return;
    }
  }

  const targetServerId = hitTestServerRow(world, renderer, panel.rackId, contentPoint);
  if (targetServerId === null) return; // dropped outside any row or the tray — cancelled

  // Dropping back onto the server it's already on is a no-op, not a move.
  if (typeof drag.origin === 'object' && drag.origin.serverId === targetServerId) return;

  const blocking = checkPlacement(world, drag.workloadId, targetServerId);
  if (blocking !== null) {
    world.addComponent(rejectedDrops, controlled, {
      serverId: targetServerId,
      blocking,
      expiresAtMs: performance.now() + REJECTED_DROP_FLASH_MS,
    });
    return;
  }

  placeWorkload(world, drag.workloadId, targetServerId);
}

// Cancels an in-progress drag without resolving a drop — used when the panel closes mid-drag.
export function cancelDrag(world: World, controlled: EntityId): void {
  world.removeComponent(dragStates, controlled);
}

export function createRackPanelSystem(
  world: World,
  inputState: InputStateTracker,
  renderer: Renderer,
  controlled: EntityId,
  camera: Camera,
): System {
  // Drag-to-scroll gesture tracking (touch has no wheel). Presentation-only transient state,
  // same reasoning as camera.ts's own drag-pan tracking for keeping it out of the ECS.
  let dragScrollPointer: { x: number; y: number } | null = null;
  let dragScrollEligible = false;

  return {
    update() {
      const panel = rackModal(world, controlled);

      // --- Chip/tray drag lifecycle ---
      // inputState's snapshot for this tick was already advanced by input.ts's own update(),
      // which runs first in main.ts's updateSystems. Left button only: this game has no other
      // drag gesture.
      const inputSnapshot = inputState.getState();
      const dragPointer = inputSnapshot.mousePosition;
      if (dragPointer && inputSnapshot.mouseButtonsPressedSincePreviousFrame.has(0)) {
        tryStartDrag(world, renderer, controlled, dragPointer);
      }
      const dragging = world.getComponent(dragStates, controlled) !== undefined;
      if (dragging && dragPointer) {
        updateDrag(world, controlled, dragPointer);
        // Left button no longer down — resolve. No dedicated release-edge field needed: dragStates
        // is itself this tick's "was a drag in progress" memory, checked fresh every frame.
        if (!inputSnapshot.mouseButtonsDown.has(0)) {
          resolveDrop(world, renderer, controlled, dragPointer);
        }
      }

      // Escape — closes this panel if open. Independently polled here rather than routed through
      // input.ts (job-panels.ts does the same for its own two panels): ActiveModal is a single
      // tagged union, so at most one of these Escape checks across the three files ever actually
      // does anything for a given press.
      if (
        inputSnapshot.keysPressedSincePreviousFrame.has('Escape') &&
        rackModal(world, controlled)
      ) {
        closeRackPanel(world, controlled);
      }

      const rejection = world.getComponent(rejectedDrops, controlled);
      if (rejection && performance.now() >= rejection.expiresAtMs) {
        world.removeComponent(rejectedDrops, controlled);
      }

      // Expire an unconfirmed decommission click — a confirm window, not a modal.
      const decommissionConfirm = world.getComponent(decommissionConfirms, controlled);
      if (decommissionConfirm && performance.now() >= decommissionConfirm.expiresAtMs) {
        world.removeComponent(decommissionConfirms, controlled);
      }

      // Scroll: only while a panel is visible (viewing, or dispatching-and-arrived — same
      // "actually on screen" gate tryStartDrag uses) and the pointer is over its content
      // viewport, so wheeling over the rest of the floor doesn't hijack the browser's own
      // scroll-suppression for nothing. Clamped every frame (not just on wheel/drag input)
      // since content height changes underneath the panel — a workload finishing and
      // disappearing from the tray, say — could leave a stale offset scrolled past the new max.
      const panelVisible = panel && (panel.mode === 'viewing' || panel.arrived);
      if (panelVisible) {
        const serverIds = serversOn(world, panel.rackId);
        const trayIds = trayWorkloadIds(world);
        const contentRect = getRackPanelContentRect(
          renderer.width,
          renderer.height,
          serverIds.length,
          trayIds.length,
        );
        const contentHeight = getRackPanelContentHeight(
          renderer.width,
          serverIds.length,
          trayIds.length,
        );
        const maxScroll = maxRackScroll(contentHeight, contentRect.height);

        const scroll = world.getComponent(rackScrolls, controlled) ?? { offsetPx: 0 };
        if (!world.getComponent(rackScrolls, controlled))
          world.addComponent(rackScrolls, controlled, scroll);

        const pointer = inputSnapshot.mousePosition;
        const wheelDeltaY = inputState.consumeWheelDeltaY();
        if (wheelDeltaY !== 0 && pointer && pointerInRect(pointer, contentRect)) {
          scroll.offsetPx += wheelDeltaY;
        }

        // Drag-to-scroll: a press that lands on the content viewport but didn't hit a chip or
        // tray card (tryStartDrag, called earlier this same update() above — would already have
        // set DragState if it had) scrolls the panel by the drag's vertical delta instead.
        // Eligibility is decided once per press so a drag that starts on a chip keeps dragging
        // that chip even if it later crosses empty background.
        const pointerDown = inputSnapshot.mouseButtonsDown.has(0);
        if (pointerDown && pointer) {
          if (dragScrollPointer === null) {
            dragScrollEligible =
              pointerInRect(pointer, contentRect) && !world.getComponent(dragStates, controlled);
          } else if (dragScrollEligible) {
            scroll.offsetPx -= pointer.y - dragScrollPointer.y;
          }
          dragScrollPointer = pointer;
        } else {
          dragScrollPointer = null;
          dragScrollEligible = false;
        }

        scroll.offsetPx = Math.min(Math.max(scroll.offsetPx, 0), maxScroll);
      } else {
        dragScrollPointer = null;
        dragScrollEligible = false;
      }

      if (panel && panel.mode === 'dispatching' && !panel.arrived) {
        const position = world.getComponent(positions, controlled);
        const grid = world.getComponent(gridPositions, panel.rackId);
        if (position && grid) {
          const rackCenter = gridToWorld(grid.gridX, grid.gridY);
          const distance = Math.hypot(rackCenter.x - position.x, rackCenter.y - position.y);
          if (distance <= DISPATCH_REACH_PX) {
            panel.arrived = true;
          }
        }
      }

      // Right-click: open (or switch to) a viewing-mode panel on the rack under the pointer.
      // Never starts a walk — inspecting a rack is remote. This is a separate signal from
      // wasClicked, so it never competes with input.ts's click chain.
      if (!inputSnapshot.wasRightClicked || !inputSnapshot.mousePosition) return;
      const pointer = inputSnapshot.mousePosition;

      const worldPointer = camera.screenToWorld(pointer);
      const { gridX, gridY } = worldToGrid(worldPointer.x, worldPointer.y);
      const rackId = findRackAt(world, gridX, gridY);
      if (rackId === null) return;

      const existing = rackModal(world, controlled);
      // Right-clicking a rack that's already open dispatching keeps it dispatching — viewing
      // is strictly weaker, so this is a no-op rather than a demotion.
      if (!existing || existing.mode !== 'dispatching' || existing.rackId !== rackId) {
        // Only one modal at a time (see ../modal.ts) — right-click, like left-click above,
        // always wins over any other open panel. This branch bypasses input.ts's own
        // click-priority chain entirely (it's driven by wasRightClicked(), a separate gesture),
        // so it needs its own guard rather than relying on that chain having already absorbed
        // the click.
        openModal(world, controlled, { kind: 'rack', rackId, mode: 'viewing', arrived: false });
        world.addComponent(rackScrolls, controlled, { offsetPx: 0 });
      }
    },
  };
}
