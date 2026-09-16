// Rack panel lifecycle: open/close (both D4 open paths), arrival detection, committing any
// PendingDrop queued while walking, and (step 8) drag-and-drop.
//
// Click/gesture ownership: input.ts owns ALL left-button pointer gestures — clicks (wasClicked,
// consumed-once) AND drags (wasPressed/wasReleased) — as a single priority chain, for the same
// reason in both cases: only one system may react to a given mousedown/mouseup pair, so a
// second independent handler here would race input.ts for the same gesture. A drag's mouseup
// also fires the browser's synthetic `click` (there's no built-in drag threshold), so input.ts
// must also be the one place that decides "this release ended a drag, don't treat it as a
// click" — splitting that decision across two systems would need cross-system signaling for a
// single boolean. Rack clicks and drags are therefore both handled in input.ts's chain by
// calling this module's exported pure functions. This module's own System owns only: right-click
// (a genuinely separate, non-conflicting event — the "view a rack" affordance), Escape, and the
// per-frame arrival/pending-drop-commit logic.
import { type World, type EntityId } from '../world';
import {
  positions,
  gridPositions,
  gridToWorld,
  worldToGrid,
  rackSlots,
  machines,
  installedIns,
  openRackPanels,
  rackScrolls,
  pendingDrops,
  dragStates,
  rejectedDrops,
  placedOns,
  workloads,
  GRID_CELL_SIZE,
} from '../components';
import { type InputState } from '../../input';
import { type Camera } from '../../camera';
import { placeWorkload, checkPlacement, unplaceWorkload } from '../dispatch';
import {
  getServerRowRect,
  getTrayCardRect,
  getTrayDropRect,
  getPlacedChipRect,
  getRackPanelContentRect,
  getRackPanelContentHeight,
  pointerInRect,
} from '../../ui/layout';
import { type Renderer } from '../../rendering';
import { type System } from './system';

// Same reach radius/approach as install-progress.ts's INSTALL_REACH_PX — the established
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
    .sort((a, b) => world.getComponent(installedIns, a)!.slotIndex - world.getComponent(installedIns, b)!.slotIndex);
}

// Accepted-but-unplaced workload ids — the tray's contents (D3), same across every panel since
// the tray isn't rack-scoped.
export function trayWorkloadIds(world: World): EntityId[] {
  return world
    .query(workloads)
    .filter((id) => world.getComponent(workloads, id)!.state === 'accepted')
    .sort((a, b) => a - b);
}

export function closeRackPanel(world: World, controlled: EntityId): void {
  world.removeComponent(openRackPanels, controlled);
  world.removeComponent(rackScrolls, controlled);
  world.removeComponent(dragStates, controlled);
  world.removeComponent(rejectedDrops, controlled);
  for (const workloadId of world.query(pendingDrops)) {
    world.removeComponent(pendingDrops, workloadId);
  }
}

// Highest legal scroll offset for the given content/viewport heights — 0 once content fits
// without scrolling. Shared by the wheel handler (clamping the new offset) and render.ts
// (nothing to draw beyond this, so it never needs to know about the clamp itself).
export function maxRackScroll(contentHeight: number, viewportHeight: number): number {
  return Math.max(0, contentHeight - viewportHeight);
}

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
  const contentRect = getRackPanelContentRect(canvasWidth, canvasHeight, serverIds.length, trayIds.length);
  if (!pointerInRect(pointer, contentRect)) return null;

  const offsetPx = world.getComponent(rackScrolls, controlled)?.offsetPx ?? 0;
  return { x: pointer.x, y: pointer.y + offsetPx };
}

// Called from input.ts's click-priority chain when a rack was clicked in dispatch mode (the
// ordinary left-click — walks the player there). Handles opening a fresh panel, re-clicking
// the already-open one (no-op), and promoting an open viewing panel to dispatching (D4:
// "switching from a viewing panel to dispatching the same rack... flips mode to 'dispatching'
// and starts the walk" — the panel stays open throughout). Returns true if a walk should start.
export function openOrPromoteRackPanel(world: World, controlled: EntityId, rackId: EntityId): boolean {
  const current = world.getComponent(openRackPanels, controlled);

  if (current?.rackId === rackId) {
    if (current.mode === 'viewing') {
      current.mode = 'dispatching';
      current.arrived = false;
      return true;
    }
    return false; // already dispatching (or already arrived) at this rack — nothing to do
  }

  world.addComponent(openRackPanels, controlled, { rackId, mode: 'dispatching', arrived: false });
  world.addComponent(rackScrolls, controlled, { offsetPx: 0 });
  return true;
}

// --- Drag and drop (step 8) ---------------------------------------------------------------
//
// Only meaningful while a panel is open in 'dispatching' mode (D4: viewing-mode rows and the
// tray render but are non-interactive — see render.ts). Drops made before `arrived` are queued
// as PendingDrop and committed by the System below once the player reaches the rack; drops
// made after arrival commit immediately.

// Workload ids placed on a given server, in the same order render.ts draws their chips.
export function placedWorkloadIds(world: World, serverId: EntityId): EntityId[] {
  return world
    .query(placedOns, workloads)
    .filter((id) => world.getComponent(placedOns, id)!.serverId === serverId)
    .sort((a, b) => a - b);
}

// mousedown hit-test + drag start, called from input.ts. Returns true if a drag was started
// (a tray card or a placed chip was under the pointer), so input.ts knows to consume the press
// rather than falling through to movement.
export function tryStartDrag(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  pointer: { x: number; y: number },
): boolean {
  const panel = world.getComponent(openRackPanels, controlled);
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
      const chip = getPlacedChipRect(serverIndex, chipIndex, canvasWidth, canvasHeight, serverIds.length, trayIds.length);
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
    const card = getTrayCardRect(trayIndex, canvasWidth, canvasHeight, serverIds.length, trayIds.length);
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
export function updateDrag(world: World, controlled: EntityId, pointer: { x: number; y: number }): void {
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
    const row = getServerRowRect(index, canvasWidth, canvasHeight, serverIds.length, trayIds.length);
    if (pointerInRect(pointer, row)) return serverIds[index];
  }
  return null;
}

const REJECTED_DROP_FLASH_MS = 900;

// mouseup — called from input.ts whenever a drag was in progress (regardless of where the
// pointer ended up), clearing DragState unconditionally. Resolves the drop:
//   - dropped on the tray, dragged from a server → unplaced immediately. Removing load never
//     needs a fit-check and never depends on being physically present (the presence gate exists
//     to stop the player placing work they can't verify fits — it has nothing to check here),
//     so this is the one drop outcome that's never queued as a PendingDrop.
//   - not over any server row or the tray → cancelled, workload stays exactly where it was.
//   - over a server row that fits → commits immediately if arrived, else queues a PendingDrop.
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

  const panel = world.getComponent(openRackPanels, controlled);
  if (!panel) return; // panel closed mid-drag — nothing to resolve against

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

  if (panel.mode === 'dispatching' && panel.arrived) {
    placeWorkload(world, drag.workloadId, targetServerId);
  } else {
    // Not yet arrived: queue it. Replaces any earlier pending drop for the same workload
    // (dragging it again before arrival should move the queued destination, not stack drops).
    for (const workloadId of world.query(pendingDrops)) {
      if (workloadId === drag.workloadId) world.removeComponent(pendingDrops, workloadId);
    }
    world.addComponent(pendingDrops, drag.workloadId, { workloadId: drag.workloadId, serverId: targetServerId });
  }
}

// Cancels an in-progress drag without resolving a drop — used when the panel closes mid-drag.
export function cancelDrag(world: World, controlled: EntityId): void {
  world.removeComponent(dragStates, controlled);
}

export function createRackPanelSystem(
  world: World,
  input: InputState,
  renderer: Renderer,
  controlled: EntityId,
  camera: Camera,
): System {
  input.onKeyDown('Escape', () => {
    if (world.getComponent(openRackPanels, controlled)) {
      closeRackPanel(world, controlled);
    }
  });

  // Drag-to-scroll gesture tracking (touch has no wheel — see
  // .plans/mobile-touch-support.md step 5). Presentation-only transient state, same reasoning
  // as camera.ts's own drag-pan tracking for keeping it out of the ECS.
  let dragScrollPointer: { x: number; y: number } | null = null;
  let dragScrollEligible = false;

  return {
    update() {
      const panel = world.getComponent(openRackPanels, controlled);

      // Expire the rejected-drop flash once its window elapses.
      const rejection = world.getComponent(rejectedDrops, controlled);
      if (rejection && performance.now() >= rejection.expiresAtMs) {
        world.removeComponent(rejectedDrops, controlled);
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
        const contentHeight = getRackPanelContentHeight(serverIds.length, trayIds.length);
        const maxScroll = maxRackScroll(contentHeight, contentRect.height);

        const scroll = world.getComponent(rackScrolls, controlled) ?? { offsetPx: 0 };
        if (!world.getComponent(rackScrolls, controlled)) world.addComponent(rackScrolls, controlled, scroll);

        const pointer = input.getPointerPosition();
        const wheelDeltaY = input.consumeWheelDeltaY();
        if (wheelDeltaY !== 0 && pointer && pointerInRect(pointer, contentRect)) {
          scroll.offsetPx += wheelDeltaY;
        }

        // Drag-to-scroll: a press that lands on the content viewport but didn't hit a chip or
        // tray card (tryStartDrag, called from input.ts's wasPressed() handling earlier this
        // same frame — input.ts runs before rack-panel.ts in updateSystems, see main.ts — would
        // already have set DragState if it had) scrolls the panel by the drag's vertical delta
        // instead. Eligibility is decided once per press so a drag that starts on a chip keeps
        // dragging that chip even if it later crosses empty background.
        const pointerDown = input.isPointerDown();
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

      // Arrival check for an open, not-yet-arrived dispatching panel.
      if (panel && panel.mode === 'dispatching' && !panel.arrived) {
        const position = world.getComponent(positions, controlled);
        const grid = world.getComponent(gridPositions, panel.rackId);
        if (position && grid) {
          const rackCenter = gridToWorld(grid.gridX, grid.gridY);
          const distance = Math.hypot(rackCenter.x - position.x, rackCenter.y - position.y);
          if (distance <= DISPATCH_REACH_PX) {
            panel.arrived = true;

            // Commit every PendingDrop queued while walking, in order, skipping any that no
            // longer fit (capacity may have shifted — a brownout, another placement — while
            // the player was en route).
            const drops = world.query(pendingDrops).sort((a, b) => a - b);
            for (const workloadId of drops) {
              const drop = world.getComponent(pendingDrops, workloadId)!;
              world.removeComponent(pendingDrops, workloadId);
              if (checkPlacement(world, workloadId, drop.serverId) === null) {
                placeWorkload(world, workloadId, drop.serverId);
              }
            }
          }
        }
      }

      // Right-click: open (or switch to) a viewing-mode panel on the rack under the pointer.
      // Never starts a walk — see D4, "inspecting a rack is remote". This is a separate event
      // from wasClicked(), so it never competes with input.ts's click chain.
      if (!input.wasRightClicked()) return;
      const pointer = input.getPointerPosition();
      if (!pointer) return;

      const worldPointer = camera.screenToWorld(pointer);
      const { gridX, gridY } = worldToGrid(worldPointer.x, worldPointer.y);
      const rackId = findRackAt(world, gridX, gridY);
      if (rackId === null) return;

      const existing = world.getComponent(openRackPanels, controlled);
      // Right-clicking a rack that's already open dispatching keeps it dispatching — viewing
      // is strictly weaker, so this is a no-op rather than a demotion.
      if (!existing || existing.mode !== 'dispatching' || existing.rackId !== rackId) {
        world.addComponent(openRackPanels, controlled, { rackId, mode: 'viewing', arrived: false });
        world.addComponent(rackScrolls, controlled, { offsetPx: 0 });
      }
    },
  };
}
