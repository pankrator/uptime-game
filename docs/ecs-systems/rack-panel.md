# rack-panel

`src/ecs/systems/rack-panel.ts` — `createRackPanelSystem(world, inputState, renderer, controlled, camera)`,
plus many exported pure/helper functions used by `input.ts` and `build.ts`

## Purpose

Owns the rack panel's full lifecycle: opening (dispatch or view-only), arrival detection,
scrolling, and drag-and-drop of workloads onto/off servers and the tray. The panel is a
full-screen modal once visible.

## Two open paths (D4)

- **Left-click a rack** (no build mode active) → `openOrPromoteRackPanel`: opens in
  `'dispatching'` mode and starts a walk there (handled via `input.ts` calling
  `moveControlledTo`). The panel stays **hidden** until the player arrives
  (`ActiveModal`'s `'rack'` variant's `arrived` field) — `render.ts` early-returns until then.
- **Right-click a rack** (handled in this system's own `update`) → opens in `'viewing'`
  mode, never starts a walk. Viewing renders identically to an arrived dispatching panel
  but accepts no drags.
- Re-clicking an open viewing panel's rack while dispatching promotes it: `mode` flips to
  `'dispatching'`, `arrived` resets to `false`, and a walk starts.

## Gesture ownership (important — read before touching input handling)

`input.ts`'s click-priority chain owns ordinary clicks (`wasClicked`) — calling
`handleRackPanelClick` once this panel is the active modal, same as every other panel. Chip/tray
drag is different since `.plans/input-router-refactor.md` D4: hit-testing chips/tray cards is
domain knowledge only this module has, so this module's own `System.update` owns the whole
press/hold/release lifecycle directly — `tryStartDrag`/`updateDrag`/`resolveDrop` are called from
here, not from `input.ts`. `inputState`'s snapshot for the tick was already advanced by
`input.ts`'s own `update()`, which runs first in `main.ts`'s `updateSystems`.

This works without cross-system signaling because the rack panel is a full-screen modal that
already absorbs every click while open (`input.ts` step 1.5) — a drag's release also being seen
as `wasClicked` is harmless, not double-handled, *except* at this panel's own excepted buttons
(close/repair/decommission/the tray card's abandon-contract corner). `tryStartDrag` avoids that
overlap by skipping the abandon-contract rect itself (see below) so a press there always falls
through as a plain click instead of starting a drag.

This module's own `System.update` also handles right-click, Escape (polled independently — see
[input](./input.md)'s notes on why that's safe), wheel-scroll, drag-to-scroll, and per-frame
arrival detection — all off `inputState` now (`src/input/index.ts` is gone).

## Drag and drop

- `tryStartDrag` — press hit-test against placed chips (checked first, top z-order)
  then tray cards, in content space (`toContentSpace`, which accounts for scroll offset
  and clips to the visible viewport). Only live for an **arrived, dispatching-mode**
  panel. Skips a tray card's own abandon-contract button corner
  (`getTrayCardDropButtonRect` — F3) so a press there falls through as a plain click
  instead of starting a drag.
- `resolveDrop` — mouseup resolution:
  - dropped on the tray, from a server → `unplaceWorkload` immediately (removing load needs
    no fit-check)
  - dropped outside any row/tray → cancelled, no-op
  - dropped back on its own current server → no-op
  - dropped on a server that fits (`checkPlacement` from `dispatch.ts`) → placed
  - dropped on a server that doesn't fit → `RejectedDrop` set (drives a red flash on the
    blocking trait bars in `render.ts` for `REJECTED_DROP_FLASH_MS`)

There is no queue-a-drop-while-walking path. A dispatching panel is not drawn until the
player arrives (`render.ts` early-returns), so there is no geometry to press against and
`tryStartDrag` refuses; a drag can only exist after arrival, and every drop commits
immediately. Making drops possible en route means drawing and hit-testing the panel while
walking — a UI feature, not a wiring change; see `.plans/ideas-backlog.md`.

## Other responsibilities

- Scroll: clamped every frame (not just on wheel input) via `maxRackScroll` (now a thin
  re-export of `ui/scroll.ts`'s shared `maxScrollOffset` — see [job-panels](./job-panels.md),
  which reuses the same formula for its own offers/jobs modals), since content height changes
  underneath the panel (a workload finishing removes a tray card).
- `closeRackPanel` clears `ActiveModal`, `RackScroll`, `DragState` and `RejectedDrop`.
- Only one modal (rack, shop, offers, jobs) can ever be recorded as open at once — `ActiveModal`
  (`components.ts`) is a single tagged-union component, not four independent ones, so mutual
  exclusion is structural rather than every opener remembering to close the other three (see
  `ecs/modal.ts`). Both open paths (left-click dispatch via
  `openOrPromoteRackPanel`, right-click view in this module's own `System`) call `../modal.ts`'s
  `openModal`, which replaces whatever was open — including an already-open offers/jobs panel —
  and runs its registered closer first (unless it's a rack panel being re-opened/promoted in
  place, e.g. switching to a different rack, which must not tear itself down). The reverse also
  holds: pressing `O`/`J` while the rack panel is open runs this module's own `closeRackPanel`
  (registered as the `'rack'` closer) before switching to the requested panel, in any mode and
  whether or not the player has arrived yet.

## Notes

- `DISPATCH_REACH_PX` (`GRID_CELL_SIZE * 1.2`) is the same reach-radius pattern as
  `install-progress.ts`'s `INSTALL_REACH_PX` — kept as a separate constant, not shared.
- See [dispatch](../ecs-systems/README.md#core-ecs) for `checkPlacement` / `placeWorkload`
  / `unplaceWorkload`, and [input](./input.md) for how gestures reach this module.
