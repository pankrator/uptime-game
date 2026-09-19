# input.ts: thin router on input-state

## Goal

`src/ecs/systems/input.ts` currently mixes two concerns: deciding **which system a
click/key belongs to** (the priority chain — load-bearing ordering, see `docs/ecs-systems/input.md`)
and, in a few places, **doing the gameplay action itself** (build-mode placement is the big
offender: `spawnRack`/`spawnCoolingUnit`/`takeFromInventory`/`startInstall` sit inline in the
router, ~40 lines). Goal: `input.ts` keeps owning ordering/arbitration (that's a real,
single-owner invariant — a click can only mean one thing), but contains zero embedded gameplay
logic — every branch is one call to a handler exported by the system that owns that domain. Also
switches `input.ts`'s own input source from `src/input/index.ts` to the new `src/input-state/`
module, extended with what a poll-based router needs.

## D1: scope — `input.ts` only, not every input consumer

`src/input/index.ts` (the old tracker) stays in place and keeps driving `camera.ts` (pan/zoom),
`job-panels.ts` (wheel scroll, O/J keys), `rack-panel.ts` (wheel scroll, drag-to-scroll-pan,
right-click-to-view, Escape), `render.ts` (hover), and `main.ts`'s F5 quicksave binding — none of
that is "the input system" in the sense this task means, and duplicating that work (touch/pinch,
long-press, wheel, right-click) onto `input-state` is a separate, larger follow-up. Two tracker
instances run side by side after this: `input` (old, still used by the systems above) and
`inputState` (new, owns `input.ts`'s router + rack-panel's chip/tray drag — see D4). They listen
to the same DOM events independently; nothing here makes them coordinate, and nothing needs them
to (see D2's ordering note).

## D2: input.ts becomes a thin, ordered router

Same priority order as today (mute → recenter → tutorial banner → HUD region → offers/jobs →
maintenance-cancel → rack panel → shop → build panel entry → build-mode placement → rack-open →
floor movement), migrated onto `input-state`'s per-frame snapshot instead of the old tracker's
`wasClicked()`/`onKeyDown()`. Every branch either:
- is already a call into another system's exported handler (`handleOffersModalClick`,
  `cancelMaintenanceTask`, `handleRackPanelClick`, `handleShopClick`, `advanceTutorial`,
  `openOrPromoteRackPanel` + `moveControlledTo`) — unchanged, stays here, this **is** the router's
  job; or
- is a one-line delegation to an object already passed in (`audio.setMuted(...)`,
  `camera.recenter()`) — stays, not meaningfully "logic"; or
- was inline gameplay logic (build panel hit-test + selection, build-mode placement) — **moves**
  to a new `build.ts` (D3).

Because a real physical click can only mean one thing, arbitration has to live somewhere single;
this keeps it in one documented file with the same explicit order as today, not spread across
system-registration order in `main.ts` (see the earlier discussion in chat — that alternative was
considered and rejected: it turns a documented invariant into an implicit one).

## D3: new `src/ecs/systems/build.ts`

Owns build mode end to end: `selectBuildable` (toggle), `hitTestBuildPanel` (moved from
`input.ts`), `handleBuildPanelClick`, and `handleBuildModePlacement` (the empty-cell spawn /
rack-install branch, including inventory/`startInstall`). Same shape as `rack-panel.ts`'s
`handleRackPanelClick` / `shop.ts`'s `handleShopClick` — a plain exported function `input.ts`
calls with a resolved pointer, no `System` of its own needed (build mode has no per-frame
behavior beyond reacting to a click/key, same as offers/jobs' click handlers).

## D4: chip/tray drag moves into `rack-panel.ts`, off input.ts entirely

Continuation of the earlier drag discussion. `tryStartDrag`/`updateDrag`/`resolveDrop` already
exist in `rack-panel.ts`; only the *lifecycle orchestration* (press → start, hold → update,
release → resolve, and consuming the paired click) moves — from `input.ts`'s `update()` into
`rack-panel.ts`'s own `update()`, reading the same `inputState` snapshot `input.ts` already
advanced this tick (input.ts runs first in `main.ts`'s `updateSystems`). `rack-panel.ts` gains an
`inputState: InputStateTracker` constructor param alongside its existing `input: InputState`
(old tracker, still used for wheel/drag-to-scroll-pan/right-click/Escape — see D1).

## D5: `input-state` additions

The router needs two things `input-state` doesn't have yet, both following the existing
accumulate-in-the-DOM-handler / consume-in-`update()` shape `mouseButtonsHeldSincePreviousFrame`
already established:
- `keysPressedSincePreviousFrame: ReadonlySet<string>` — keys that went down since the last
  `update()` call (not "currently held", which would repeat-fire a one-shot action like Escape or
  a build hotkey every frame it's held). Accumulated in `keydown`, never removed until consumed by
  `update()` — so a key pressed and released within the same frame still registers, same reasoning
  as the mouse click case below.
- `wasClicked: boolean` — press+release within `TAP_MAX_MOVEMENT_PX`-equivalent movement, one-shot
  per `update()`. Needs a tracked press-origin per left-button press, accumulated on qualifying
  `mouseup` (not deferred to `update()`, for the same same-frame-click reason as above), consumed
  on the next `update()`.

`update()` must actually be called somewhere now — `input.ts`'s `System.update()` calls it once,
first thing, since it already runs first in `updateSystems`; `rack-panel.ts` reads the same
already-advanced snapshot rather than calling `update()` a second time.

## Files

- `src/input-state/index.ts` — add `keysPressedSincePreviousFrame`, `wasClicked`, press-origin
  tracking, `event.preventDefault()` on qualifying mousedown (parity with the old tracker's
  refresh/selection suppression).
- `src/ecs/systems/build.ts` (new) — `selectBuildable`, `hitTestBuildPanel`,
  `handleBuildPanelClick`, `handleBuildModePlacement`.
- `src/ecs/systems/input.ts` — rewritten as the thin router described above, on `inputState`
  instead of `input`; drag lifecycle and build-mode logic removed.
- `src/ecs/systems/rack-panel.ts` — add `inputState` param; own the chip/tray drag lifecycle in
  its own `update()`.
- `src/main.ts` — construct `inputState = createInputStateTracker(canvas)`; pass it to
  `createInputSystem` and `createRackPanelSystem`.
- `docs/ecs-systems/input.md`, `rack-panel.md`, `README.md` — reflect the new split.

## Non-goals (this pass)

- Retiring `src/input/index.ts` entirely (D1).
- Touch/pointer-event support on `input-state` (needed before rack-panel's drag works on touch —
  flagged in the earlier chat, not required for this refactor to be correct on desktop).
