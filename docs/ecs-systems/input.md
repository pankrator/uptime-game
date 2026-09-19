# input

`src/ecs/systems/input.ts` — `createInputSystem(world, inputState, renderer, controlled, facility, camera, audio, events)`

See [build](./build.md) for build mode (extracted from this file — `.plans/input-router-refactor.md`
D3) and [rack-panel](./rack-panel.md) for chip/tray drag (extracted — D4).

## Purpose

Arbitration only: decides which system a click or key belongs to, in one documented, ordered
place — a real click/key can only mean one thing, so this can't be split across systems without
either double-handling or an implicit, undocumented order (see `.plans/input-router-refactor.md`
for why that was rejected). Contains no gameplay logic of its own — every branch is a
precondition check (is a panel open, is build mode active — inherently cross-system knowledge)
or a single call into the system that owns that domain.

Reads `src/input-state/index.ts`'s `InputStateTracker` — the sole input tracker in the game now
(`src/input/index.ts` is gone; every consumer migrated onto `inputState`, see the plan's D1
follow-up). This system runs first in `main.ts`'s `updateSystems` and calls `inputState.update()`
as the first thing it does each tick, advancing the frame snapshot every other simulation-tick
`inputState` reader (`rack-panel.ts`'s drag, `job-panels.ts`, the quicksave poll in `main.ts`)
sees this tick. Render-loop readers (`camera.ts`, `render.ts`'s hover) read continuous fields
(position, held buttons) or the dedicated `consumeWheelDeltaY`/`consumeZoomDelta` drain-on-read
methods instead — see `input-state/index.ts`'s file header for why those two can't be plain
snapshot fields.

## Keys (polled each tick via `keysPressedSincePreviousFrame`)

- `Escape` — closes shop panel if open, else clears build mode (a separate handler in
  [job-panels](./job-panels.md) also closes the offers/jobs panel on the same key, if open)
- Number keys `1..N` (one per `BUILDABLES` entry) — toggle build mode for that buildable
  (`build.ts`'s `selectBuildable`), ignored while an install task is active or the offers/jobs
  panel is open
- `O`/`J` — offers/jobs panel toggles, registered and owned by
  [job-panels](./job-panels.md), not this file

## Per-frame priority chain (`update`)

Only if `wasClicked`, in strict order:
-1. Mute button (`getMuteButtonRect`) — always reachable, checked before anything else can
   swallow the click. See [audio](./audio.md).
-0.95. Recenter-camera button — only reachable while the camera is manually panned away.
-0.5. Tutorial banner action/skip buttons — always reachable, sits above every other panel.
0. `pointerInHud` check — HUD-region clicks otherwise fall through to nothing
0.7. Offers/jobs panel open → **absorbs every click**, delegated to
   [job-panels](./job-panels.md)'s `handleOffersModalClick`/`handleJobsModalClick`. Mutually
   exclusive with steps 1.5/1.6 below, but not blocked by them: pressing O/J while the rack or
   shop panel is open closes it and switches straight to the requested panel — see
   `../modal.ts`'s `openModal`/`activeModal` and job-panels.ts's `closeJobPanels`.
1. Maintenance task active → any click cancels + refunds (`maintenance.ts`'s
   `cancelMaintenanceTask`)
1.5. Rack panel visible (viewing, or dispatching-and-arrived) → **absorbs every click**,
   delegated to `rack-panel.ts`'s `handleRackPanelClick` (close button, repair/decommission
   buttons, each tray card's abandon-contract button — full-screen modal)
1.6. Shop panel open → **absorbs every click**, delegated to `shop.ts`'s `handleShopClick`
2. Build panel entry hit → `build.ts`'s `handleBuildPanelClick`
3. Build mode active → `build.ts`'s `handleBuildModePlacement` (place a rack/CRAC on an empty
   cell, or start an install into a rack, at the clicked grid cell)
4. Rack clicked (no build mode) → `openOrPromoteRackPanel` (rack-panel.ts) + `moveControlledTo`
5. Otherwise → plain floor click: `moveControlledTo` (`../movement-commands.ts`), cancelling any
   not-yet-arrived pending dispatch panel (the player redirected away from it)

Chip/tray drag no longer runs through this file at all — it's `rack-panel.ts`'s own
`System.update()`, reading the same `inputState` snapshot this system advanced earlier in the
tick. See [rack-panel](./rack-panel.md)'s header comment for why that's safe without this file's
involvement.

## Notes

- The ordering above is load-bearing — e.g. rack-panel and shop are both "absorb every
  click" modals, and either being checked in the wrong order relative to build mode or
  the build panel would swallow input incorrectly.
- `src/input-state/index.ts` is the only input tracker in the game — `src/input/index.ts` was
  removed once every consumer (`camera.ts`, `job-panels.ts`, `rack-panel.ts`, `render.ts`,
  `main.ts`'s quicksave) migrated onto it (`.plans/input-router-refactor.md` D1 follow-up).
- Escape is polled independently in three places (this file, `job-panels.ts`, `rack-panel.ts`),
  each gated on its own precondition — safe because `ActiveModal` is a single tagged union (at
  most one of shop/offers/jobs/rack is ever open) and this file's own shop-vs-build-mode branch
  already picks at most one action per press.
