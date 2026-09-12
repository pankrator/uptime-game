# Player movement

## Context

CLAUDE.md's "First Features" lists player movement as feature 1: top-down movement around the
datacenter floor, driven by the `input` module, with `entities` holding the player entity.
The current scaffold (`src/core`, `src/rendering`, `src/input`, `src/entities`, `src/state`)
has the right module shape but no actual gameplay code: `entities: Entity[]` in `main.ts` is
empty, and — critically — the game loop (`src/core/index.ts`) accepts `input` in
`GameLoopDeps` but never reads it; `Entity.update(deltaSeconds)` has no way to consult input
today. This plan adds a player entity that moves freely (continuous pixel movement, not
grid-snapped) around the canvas using **click-to-move**: clicking anywhere on the canvas sets
a destination, and the player walks toward it at a fixed speed until it arrives, closing that
gap.

Note: `.plans/floor-rack-placement.md` also needs mouse/click input (for placing racks), so
both plans touch `src/input/index.ts` to add pointer/click tracking. Whichever is implemented
first should add that input support; the other reuses it rather than re-adding it. A single
click must not both move the player and place a rack — see step 2 below for how the two are
told apart.

Per the user's direction: input access works via an **InputManager** that is constructed once
and wired into entities that need it (as a constructor dependency), rather than changing the
shared `Entity.update(deltaSeconds)` signature or threading input through `core`'s loop. This
keeps `core` and the `Entity` interface untouched and keeps the change additive.

## Approach

1. **Add pointer/click tracking to `src/input/index.ts`** (the InputManager), if not already
   present from `.plans/floor-rack-placement.md`:
   - Add `getPointerPosition(): { x: number; y: number } | null` (latest `mousemove`
     position relative to the canvas, null until the mouse has moved over it at least once)
     and `wasClicked(): boolean` (true for exactly one read after a `click` event — a
     consume-on-read flag, reset once read, so one click is never processed twice).
   - Keep the existing `isKeyDown` untouched; this is additive to `InputState`, not a
     replacement — `isKeyDown` may still be useful for future features even though the player
     no longer uses it for movement.
   - If `.plans/floor-rack-placement.md` is implemented first and already added this exact
     API, reuse it as-is rather than re-adding it.

2. **Add a `Player` entity** in `src/entities/index.ts` (still the only file in that module,
   consistent with its current flat-barrel shape):
   - `createPlayer(input: InputState, start: { x: number; y: number }): Entity`
   - Internal state: current `x`/`y` position (continuous, not grid-snapped), an optional
     `target: { x: number; y: number } | null` destination, and a fixed `speed`
     (pixels/second).
   - `update(deltaSeconds)`: if `input.wasClicked()` and `getPointerPosition()` returns a
     position, set that as the new `target` (a fresh click always retargets, even mid-walk).
     Then, if `target` is set, move `x`/`y` toward it by up to `speed * deltaSeconds`; if the
     remaining distance is smaller than that step, snap exactly to `target` and clear it (so
     the player stops precisely on arrival rather than overshooting or jittering).
   - `render(context)`: draws the player as a simple filled shape (e.g. a colored circle or
     square) at its current `x`/`y` — placeholder art is fine, this is about movement
     mechanics, not visuals.
   - No canvas-bounds clamping needed here: clicks originate from `getPointerPosition()`,
     which is already within canvas bounds, so the player naturally never targets a point off
     the visible area.

3. **Decide click ownership between player movement and rack placement**: since both this
   plan and `.plans/floor-rack-placement.md` react to the same click, a single click must
   resolve to exactly one action, not both. Simplest rule, applied wherever both entities are
   wired together in `main.ts`: **if the click lands on an empty grid cell it places a rack
   (per the floor-rack-placement plan); otherwise (including clicks that aren't on a valid
   placement cell) it moves the player.** Whichever entity is registered to consume the click
   first should apply this precedence, or a shared `input` method can hand out the click as
   "consumed" so the second entity that checks `wasClicked()` in the same frame sees it as
   already handled — pick whichever is simpler once both features exist. If floor-rack
   placement is not yet implemented, every click is simply a move command.

4. **Wire it up in `src/main.ts`**: construct the player via `createPlayer(input, { x: ..., y:
   ... })` (centered on canvas as a reasonable start position) and push it into the existing
   `entities` array before `loop.start()`. No changes needed to `createGameLoop` itself — it
   already iterates `entities` for both `update` and `render` each frame.

5. **No changes to `src/core/index.ts` or `src/state/index.ts`** in this plan — the loop's
   existing update-then-render-all-entities cycle suffices, and `GameState` doesn't need
   player position (the player entity owns its own position internally).

## Files to be modified

- `src/input/index.ts` — add pointer position + click tracking (shared with
  `.plans/floor-rack-placement.md`; implement once, whichever plan lands first).
- `src/entities/index.ts` — add `Player`/`createPlayer` alongside the existing `Entity`
  interface.
- `src/main.ts` — construct and register the player entity.

## Verification

- `npm run dev`, open the app in a browser: clicking anywhere on the canvas makes the player
  shape walk smoothly toward that point and stop exactly there (no overshoot/jitter);
  clicking again mid-walk immediately retargets to the new point.
- `npm run lint` and `npm run build` pass cleanly (TypeScript strict flags: `noUnusedLocals`/
  `noUnusedParameters` mean the `input` parameter must actually be read inside `update`).
