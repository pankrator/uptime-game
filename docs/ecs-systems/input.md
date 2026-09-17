# input

`src/ecs/systems/input.ts` — `createInputSystem(world, input, renderer, controlled, facility, camera, audio)`,
plus exported `moveControlledTo`

## Purpose

Owns every left-button pointer gesture (plain clicks and drags) as one priority chain,
plus keyboard shortcuts for build mode. This is the single dispatcher that decides what a
click/drag means depending on current UI state — no other system independently
interprets `wasClicked`/`wasPressed`/`wasReleased`.

## Keyboard (registered once, outside `update`)

- `Escape` — closes shop panel if open, else clears build mode (a separate handler in
  [job-panels](./job-panels.md) also closes the offers/jobs panel on the same key, if open)
- Number keys `1..N` (one per `BUILDABLES` entry) — toggle build mode for that buildable,
  ignored while an install task is active or the offers/jobs panel is open
- `O`/`J` — offers/jobs panel toggles, registered and owned by
  [job-panels](./job-panels.md), not this file

## Per-frame priority chain (`update`)

Drag lifecycle runs unconditionally every frame (independent of `wasClicked()`, since a
drag spans multiple frames):
1. `wasPressed()` → `tryStartDrag` (rack-panel.ts) — may begin a drag
2. drag in progress → `updateDrag` (rack-panel.ts) — follows the pointer
3. `wasReleased()` while a drag was in progress → consumes the paired synthetic
   `wasClicked()` (so a drag-release never also triggers a walk) and calls `resolveDrop`

Then, only if `wasClicked()` (and not already consumed by a drag), in strict order:
-1. Mute button (`getMuteButtonRect`) — always reachable, checked before anything else can
   swallow the click. See [audio](./audio.md).
0. `pointerInHud` check — HUD-region clicks otherwise fall through to nothing
0.7. Offers/jobs panel open → **absorbs every click**, delegated to
   [job-panels](./job-panels.md)'s `handleOffersModalClick`/`handleJobsModalClick` (close
   button, and for offers, each card's accept/decline — accepting an offer nothing currently
   fits requires a second click within a window to confirm, `AcceptConfirm`, same "second click
   on the same button" shape as `DecommissionConfirm` below — see `.plans/playtest-findings.md`
   F3). Mutually exclusive with steps 1.5/1.6 below — see job-panels.ts's
   `otherModalBlocking`/`closeJobPanels`.
1. Install task active → any click cancels + refunds to inventory (`cancelInstallTask`)
1.5. Rack panel visible (viewing, or dispatching-and-arrived) → **absorbs every click**
   except its close button, repair/decommission buttons, and each tray card's small
   abandon-contract button (`dispatch.ts`'s `abandonWorkload` — F3) (full-screen modal)
1.6. Shop panel open → **absorbs every click**: close button, category tabs, buy buttons
2. Build panel entry hit → toggles that buildable's build mode
3. Build mode active → place a rack (`'empty-cell'`) or start an install
   (`'rack'`, via `tryInstallIntoRack`) at the clicked grid cell
4. Rack clicked (no build mode) → `openOrPromoteRackPanel` (rack-panel.ts) + walk there
5. Otherwise → plain floor click: `moveControlledTo`, cancelling any not-yet-arrived
   pending dispatch panel (the player redirected away from it)

## `moveControlledTo(world, controlled, facility, targetPixel)`

Shared pathing entry point (also called by `rack-panel.ts` for the walk-to-rack case):
resolves walkable regions (`world-map.ts`), finds the nearest walkable neighbor if the
target itself is blocked, runs `findPath` (`pathfinding.ts`), simplifies it to a pixel
path, and attaches it as a `PathFollow`.

## Notes

- The ordering above is load-bearing — e.g. rack-panel and shop are both "absorb every
  click" modals, and either being checked in the wrong order relative to build mode or
  the build panel would swallow input incorrectly.
- See [rack-panel](./rack-panel.md) for why drag/click ownership is centralized here
  rather than split across systems.
- `src/input/index.ts`'s `InputState.getPointerPosition()` now also tracks continuous
  mouse-hover position (no button held) — previously it only updated during an active
  press/drag, so `getPointerPosition()` returned stale/null between clicks. Needed for
  [render](./render.md)'s hover-gated rack labels (F8); does not change press/click/drag
  behavior, since it only fires when no primary pointer is currently down.
