# rack-panel

`src/ecs/systems/rack-panel.ts` — `createRackPanelSystem(world, input, renderer, controlled, camera)`,
plus many exported pure/helper functions used by `input.ts`

## Purpose

Owns the rack panel's full lifecycle: opening (dispatch or view-only), arrival detection,
scrolling, and drag-and-drop of workloads onto/off servers and the tray. The panel is a
full-screen modal once visible.

## Two open paths (D4)

- **Left-click a rack** (no build mode active) → `openOrPromoteRackPanel`: opens in
  `'dispatching'` mode and starts a walk there (handled via `input.ts` calling
  `moveControlledTo`). The panel stays **hidden** until the player arrives
  (`OpenRackPanel.arrived`) — `render.ts` early-returns until then.
- **Right-click a rack** (handled in this system's own `update`) → opens in `'viewing'`
  mode, never starts a walk. Viewing renders identically to an arrived dispatching panel
  but accepts no drags.
- Re-clicking an open viewing panel's rack while dispatching promotes it: `mode` flips to
  `'dispatching'`, `arrived` resets to `false`, and a walk starts.

## Gesture ownership (important — read before touching input handling)

`input.ts` owns **all** left-button pointer gestures (clicks and drags) as a single
priority chain, because a drag's `mouseup` also fires the browser's synthetic `click`
(no built-in drag threshold) — only one place can decide "this release ended a drag,
don't also treat it as a click." This module exposes pure functions
(`tryStartDrag`, `updateDrag`, `resolveDrop`, `cancelDrag`) that `input.ts` calls into.
This module's own `System.update` handles only right-click, Escape, and per-frame
arrival/scroll/pending-drop logic — nothing that could race `input.ts` for the same
gesture.

## Drag and drop

- `tryStartDrag` — mousedown hit-test against placed chips (checked first, top z-order)
  then tray cards, in content space (`toContentSpace`, which accounts for scroll offset
  and clips to the visible viewport). Only live for an **arrived, dispatching-mode**
  panel. Skips a tray card's own abandon-contract button corner
  (`getTrayCardDropButtonRect` — F3) so a press there falls through as a plain click for
  `input.ts` to handle, rather than starting a drag.
- `resolveDrop` — mouseup resolution:
  - dropped on the tray, from a server → `unplaceWorkload` immediately (never queued —
    removing load needs no fit-check and no presence gate)
  - dropped outside any row/tray → cancelled, no-op
  - dropped back on its own current server → no-op
  - dropped on a server that fits (`checkPlacement` from `dispatch.ts`) → commits
    immediately if arrived, else queued as `PendingDrop`
  - dropped on a server that doesn't fit → `RejectedDrop` set (drives a red flash on the
    blocking trait bars in `render.ts` for `REJECTED_DROP_FLASH_MS`)
- `PendingDrop`s made while still walking are committed in arrival order once
  `System.update` detects arrival, skipping any that no longer fit (capacity may have
  shifted en route).

## Other responsibilities

- Scroll: clamped every frame (not just on wheel input) via `maxRackScroll`, since
  content height changes underneath the panel (a workload finishing removes a tray card).
- `closeRackPanel` clears `OpenRackPanel`, `RackScroll`, `DragState`, `RejectedDrop`, and
  any leftover `PendingDrop`s.

## Notes

- `DISPATCH_REACH_PX` (`GRID_CELL_SIZE * 1.2`) is the same reach-radius pattern as
  `install-progress.ts`'s `INSTALL_REACH_PX` — kept as a separate constant, not shared.
- See [dispatch](../ecs-systems/README.md#core-ecs) for `checkPlacement` / `placeWorkload`
  / `unplaceWorkload`, and [input](./input.md) for how gestures reach this module.
