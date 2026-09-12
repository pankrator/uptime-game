# Datacenter floor & rack placement

## Context

CLAUDE.md's "First Features" lists floor & rack placement as feature 2: a grid-based floor
layout where the player places racks in aisles, with racks as containers that will later hold
machines (feature 3). Per the user's answers: player movement stays free-form pixel movement
(see `.plans/player-movement.md`) while **rack placement snaps to a grid**; and this first
pass explicitly **skips collision** between the player and placed racks — that's a deliberate
follow-up once both features exist and can be tuned together.

This plan was originally written before `.plans/ecs-migration.md` and described racks as a
`state.racks` array drawn by a `Floor` entity. The codebase is now ECS
(`src/ecs/world.ts`, `src/ecs/components.ts`, `src/ecs/systems/`), and
`.plans/ecs-migration.md` already pre-built most of what this plan needs: `InputState` already
has `getPointerPosition()`/`wasClicked()`, `components.ts` already declares `GridPosition` and
a `Renderable.kind` of `'grid-cell' | 'rack'`, and `createInputSystem` already consumes clicks
to set the player's `MoveTarget`. This revision re-specifies the plan in ECS terms and resolves
the one open question the migration plan left behind: a single click must not both move the
player and place a rack.

## Approach

1. **Grid concept lives in `src/ecs/components.ts`**, not `src/state`, since it's the
   coordinate system racks (entities) are placed in, not app-level state:
   - `GRID_CELL_SIZE` constant (pixels per grid cell).
   - `worldToGrid(x, y): { gridX: number; gridY: number }` helper for snapping a pixel
     position to a grid cell.
   - `GridPosition` (already present) is the component racks carry instead of `Position`.

2. **`spawnRack(world, gridX, gridY): EntityId`** in `src/entities/index.ts`, alongside
   `spawnPlayer`: attaches `GridPosition` and `Renderable({ kind: 'rack' })`. No `Position` —
   racks live in grid space only.

3. **Click ownership, resolved inside `createInputSystem`** (`src/ecs/systems/input.ts`):
   on `wasClicked()`, snap the pointer to a grid cell via `worldToGrid`. If any existing entity
   has a `GridPosition` at that cell, treat the click as a move command (set the controlled
   entity's `MoveTarget`, existing behavior). Otherwise spawn a rack at that cell. This makes
   "click an empty cell places a rack, any other click moves the player" a single branch in one
   system rather than two systems racing over the same click — resolves the open question left
   by `.plans/player-movement.md` step 3 and `.plans/ecs-migration.md`.

4. **Rendering** (`src/ecs/systems/render.ts`):
   - Grid lines are a floor-wide draw, not a per-entity one — drawn unconditionally once per
     frame from `renderer.canvas` dimensions at `GRID_CELL_SIZE` spacing, before entities are
     drawn. (The `'grid-cell'` renderable kind was removed as dead — nothing ever spawns an
     entity for a grid cell.)
   - Racks are drawn via `world.query(renderables, gridPositions)`, filtered to
     `kind === 'rack'`, as filled rectangles at `gridX/gridY * GRID_CELL_SIZE`.
   - Player-circle rendering is unchanged, queried separately via `positions` instead of
     `gridPositions`.

5. **No changes needed to `src/main.ts`**: the input/render systems already receive `world`,
   so no new wiring is required beyond what `.plans/ecs-migration.md` already put in place.

## Files modified

- `src/ecs/components.ts` — added `GRID_CELL_SIZE`, `worldToGrid`; removed the dead
  `'grid-cell'` renderable kind.
- `src/entities/index.ts` — added `spawnRack`.
- `src/ecs/systems/input.ts` — click now checks for an occupied grid cell before deciding
  between "place rack" and "move player".
- `src/ecs/systems/render.ts` — added grid-line drawing and rack rendering.

## Verification

- `npm run dev`, open the app in a browser: a grid is visible across the canvas; clicking an
  empty cell places a rack (filled rectangle) snapped to that cell; clicking an
  already-occupied cell moves the player there instead of placing a duplicate rack; the player
  can walk freely over racks with no collision, confirming this pass intentionally has none.
- `npm run lint` and `npm run build` pass cleanly.
