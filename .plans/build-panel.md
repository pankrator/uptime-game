# Build panel: select-then-place buildables, with movement blocked while placing

## Context

Right now `createInputSystem` (`src/ecs/systems/input.ts`) spawns a rack immediately on any
click that lands on an empty grid cell — there is no selection step, and the player can walk
around freely at all times, including mid-placement (there is no "mid-placement" state at
all). CLAUDE.md's feature list calls for the player to explicitly choose what to build from a
panel before placement is possible, and movement should be blocked while a placement is
pending. This plan introduces that selection step as a build mode, gated by a panel of
buildable options, without pulling in machines/network gear yet — per CLAUDE.md's feature
order, racks are the only buildable today; the panel is structured so adding more later is a
data change, not a redesign.

Per the user's direction:
- **Panel scope**: racks only for now. Structured as a small data table of buildable
  definitions so machines/network gear slot in later without redesigning the panel.
- **Rendering**: the panel is drawn on Canvas (not a DOM overlay), consistent with "all
  drawing goes through Canvas" — this makes it another render system rather than an exception
  to that rule, and keeps hit-testing in the same input system that already resolves clicks.
- **Placement flow**: selecting a buildable enters build mode (movement blocked); clicking a
  valid empty grid cell places it and returns to normal mode; clicking the same panel entry
  again or pressing Esc cancels back to normal mode without placing.

## Approach

1. **New component: `BuildMode`** (`src/ecs/components.ts`) — a single-entity marker (attached
   to the controlled/player entity) rather than free-floating app state, so it composes with
   the existing ECS instead of introducing a second parallel state container next to `World`:
   - `interface BuildMode { buildableId: BuildableId }`
   - `export const buildModes = createComponentStore<BuildMode>();`
   - Presence of this component on the controlled entity *is* "currently placing something";
     absence is normal mode. This is the single source of truth both the movement-blocking
     logic and the panel's highlight state read from.

2. **Buildable registry** (`src/ecs/components.ts`, alongside the component defs — this is
   static game data, not behavior):
   ```ts
   export type BuildableId = 'rack';

   export interface BuildableDef {
     id: BuildableId;
     label: string;
   }

   export const BUILDABLES: BuildableDef[] = [
     { id: 'rack', label: 'Rack' },
   ];
   ```
   Adding a machine later means appending one entry here plus a `spawnMachine`/placement-case
   branch — not touching the panel layout or input-resolution logic.

3. **Panel layout constants** (`src/ecs/components.ts` or a small new
   `src/ecs/build-panel-layout.ts` if `components.ts` gets crowded — decide at implementation
   time): fixed screen-space rectangle per buildable entry (e.g. a column of buttons anchored
   to the bottom-left of the canvas, `BUILD_PANEL_ENTRY_HEIGHT`/`WIDTH`/margins as constants).
   Screen-space, not grid/world-space, since the panel is UI chrome pinned to the viewport, not
   part of the floor.

4. **Input resolution rewritten as an explicit priority chain**
   (`src/ecs/systems/input.ts`), replacing today's single "occupied → move, else → place"
   branch:
   - **Esc pressed** (new edge-triggered key-read — see step 5) **and build mode active**:
     remove `BuildMode` from the controlled entity (cancel), return.
   - **Click and build mode active**:
     - If the click hits the *currently selected* panel entry's rectangle: cancel build mode
       (toggle off), return.
     - Else if the click hits a *different* panel entry's rectangle: switch `BuildMode` to that
       buildable (re-select), return.
     - Else if the click hits an empty grid cell (existing `worldToGrid` + occupancy check):
       place the buildable (`spawnRack` today; a small switch on `buildableId` once more exist).
       **`BuildMode` stays active** — placement repeats on further clicks until the player
       cancels (Esc or reselecting the same panel entry), so laying out several racks in a row
       doesn't require reopening the panel each time.
     - Else (click on an occupied cell): no-op — deliberately does *not* fall through to
       movement, since movement is blocked in build mode regardless (see step 6).
   - **Click and build mode inactive**: click a panel entry → enter build mode for that
     buildable; otherwise (any other click, empty or occupied space alike) → move there. This
     is a behavior change from the pre-panel version, which only moved on clicks that landed on
     an occupied cell — now that placement requires going through the panel first, a bare click
     on empty space is unambiguously a move command.

5. **Event-driven key handler, added to `InputState`** (`src/input/index.ts`): Esc needs to fire
   once per press, not continuously like level-triggered `isKeyDown` would. A polled
   consume-on-read flag (mirroring `wasClicked`) turned out to be fragile here: the input
   system only polls on certain frames depending on state, so a press can go unconsumed and
   then get eaten by an unrelated later poll. Instead, add
   `onKeyDown(key: string, handler: () => void): () => void` — registers a callback invoked
   directly from the `keydown` listener (returns an unsubscribe function). The input system
   registers its Esc handler once, outside the per-frame `update()`, so cancellation reacts
   immediately to the event rather than being polled. `isKeyDown` stays untouched.

6. **Movement blocking**: the movement system itself doesn't need to change — it only acts on
   entities that have a `MoveTarget`, and a `MoveTarget` is only ever set by the input system.
   The block belongs in `createInputSystem`: the "click an occupied cell → set `MoveTarget`"
   branch only runs when the controlled entity has no `BuildMode` component. This keeps the
   blocking rule co-located with the one place `MoveTarget` gets assigned, rather than adding a
   guard inside the movement system that would have to know about an unrelated component.

7. **Rendering** (`src/ecs/systems/render.ts`): add a `drawBuildPanel(renderer, world,
   controlled)` step, drawn last (on top of the floor/entities) each frame:
   - Iterate `BUILDABLES`, draw each entry's rectangle (from the layout constants) with its
     label (`context.fillText`).
   - If the controlled entity currently has a `BuildMode` matching that entry's `buildableId`,
     draw it with a highlighted/selected style (different fill or a border) so the player can
     see what's active — this is the panel's only visual state, read directly from the
     `BuildMode` component rather than duplicated into a separate UI state object.

## Files modified

- `src/ecs/components.ts` — add `BuildMode` component + store, `BuildableId`/`BuildableDef`/
  `BUILDABLES`, and panel layout constants (or a new sibling file if this gets crowded).
- `src/ecs/systems/input.ts` — replace the two-branch click resolution with the build-mode
  priority chain described in step 4; add Esc handling.
- `src/input/index.ts` — add `onKeyDown(key: string, handler: () => void): () => void` to
  `InputState`.
- `src/ecs/systems/render.ts` — add build panel drawing, reading `BuildMode` for highlight
  state.

## Verification

- `npm run dev`, open in browser: clicking "Rack" in the panel highlights it and blocks player
  movement (clicking the floor no longer moves the player); clicking an empty grid cell while
  Rack is selected places a rack and **stays in build mode** (panel entry still highlighted),
  so clicking further empty cells places more racks without reselecting; clicking "Rack" again
  while selected, or pressing Esc, cancels back to normal mode without placing; after
  cancelling, clicking anywhere on the floor (empty or occupied by a rack) moves the player.
- `npm run lint` and `npm run build` pass cleanly.
