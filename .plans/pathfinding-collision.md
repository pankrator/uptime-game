# Collision + A* pathfinding for player movement

## Addendum: line-of-sight path simplification

The initial implementation converted every A* grid cell into a waypoint at its pixel center,
so the player visibly hopped center-to-center in right-angle steps even across open floor. Per
follow-up direction, movement should look free rather than grid-locked, while still routing
around obstacles found by A*. Fix, in `src/ecs/pathfinding.ts`:

- `simplifyPathToPixels(world, bounds, start, path, end)` — string-pulls the raw cell-center
  path (plus the exact start/end pixels) down to the fewest straight legs: walks the point list
  keeping an anchor, and only emits a waypoint when the line from the anchor to the *next* point
  would cross a non-walkable cell (`hasLineOfSight`, sampled every quarter-cell along the
  segment). This is a lightweight string-pull, not a full visibility-graph rebuild — cheap enough
  to run per click at this game's scale.
- The final waypoint is now the exact clicked pixel when the clicked cell is walkable (not its
  cell center), so short moves within one cell of open floor go directly there instead of
  snapping. When the click lands on an obstacle, the endpoint still resolves to the chosen
  neighbor cell's center (there's no other canonical point on an occupied cell to aim for).
- `createInputSystem`'s `moveControlledTo` now takes the raw target pixel (not pre-rounded grid
  coordinates), computes the grid cell only for pathfinding/occupancy checks, and passes the
  player's exact current `Position` and the resolved end pixel into `simplifyPathToPixels`
  instead of building cell-center waypoints itself.
- `PathFollow`/`path-follow.ts`/`movement.ts` are unchanged — they were already agnostic to how
  many waypoints there are or what pixel they sit at.

## Context

Movement today (`src/ecs/systems/movement.ts`, `src/ecs/components.ts`) is a straight-line walk:
click sets a single `MoveTarget`, and `createMovementSystem` steps `Position` toward it each
frame with no regard for obstacles. `.plans/floor-rack-placement.md` explicitly skipped
player/rack collision as a deliberate follow-up "once both features exist and can be tuned
together" — this plan is that follow-up, plus the ask to have clicking a rack stop the player in
front of it rather than walking into (or through) it.

Per the user's direction:
- **Blocked cells**: any entity with a `GridPosition` component blocks its cell (not
  hardcoded to `Renderable.kind === 'rack'`), so future buildables (machines, network gear) that
  get their own `GridPosition` block automatically without touching the pathfinding code.
- **Clicking an occupied cell**: path to whichever walkable orthogonal neighbor of that cell is
  cheapest to reach from the player's current position (not a fixed "south face" approach).
- **Movement feel**: stays continuous free-pixel movement (unchanged `Position`/`Speed`/
  `MoveTarget` interpolation in `movement.ts`). A* runs on the grid only to produce a sequence of
  cell-center waypoints; a new system feeds them into the existing `MoveTarget` one at a time.
  This keeps the working movement code untouched and additive.

## Approach

1. **Floor bounds become grid-space data, not draw-time constants**
   (`src/ecs/components.ts`): `render.ts` currently hardcodes `BUILDING_MARGIN`/
   `BUILDING_WALL_THICKNESS` as local constants used only for drawing. Pathfinding needs the same
   bounds to know which cells exist at all. Move `BUILDING_MARGIN` into `components.ts` (or a new
   `src/ecs/grid.ts` if `components.ts` is getting crowded — see step 2) as the single source of
   truth; `render.ts` imports it instead of redeclaring it. `BUILDING_WALL_THICKNESS` stays local
   to `render.ts` since it's purely a stroke width, not a layout fact pathfinding needs.

2. **New module `src/ecs/pathfinding.ts`** (grid model + A*, kept out of `components.ts` since
   it's an algorithm, not component/data definitions — consistent with `systems/` being separate
   from `components.ts` today):
   - `getFloorGridBounds(canvas): { minGridX, minGridY, maxGridX, maxGridY }` — derives the
     walkable grid extent from canvas size and `BUILDING_MARGIN`, via `worldToGrid`.
   - `isWalkable(world, bounds, gridX, gridY): boolean` — false if outside bounds, false if any
     entity's `GridPosition` occupies that cell (queries `world.query(gridPositions)`, matching
     the "any `GridPosition` blocks" decision), true otherwise.
   - `findPath(world, bounds, start: GridCell, goal: GridCell): GridCell[] | null` — standard A*
     over the 4-directionally-connected grid (no diagonals, matching the existing 4-neighbor
     movement feel and avoiding corner-cutting through diagonally-adjacent racks), Manhattan
     distance heuristic, binary-heap-free priority handling is fine at this game's scale (small
     grids, one pathfinding agent) — a sorted-insert array or simple linear-scan open set is
     enough; no need for a heap library. Returns `null` when no path exists (e.g. goal fully
     boxed in) so callers can no-op instead of crashing.
   - `findNearestWalkableNeighbor(world, bounds, cell: GridCell, from: GridCell): GridCell | null`
     — for the "clicked an occupied cell" case: examines the clicked cell's 4 orthogonal
     neighbors, keeps the walkable ones, and returns the one with the shortest **path** distance
     from `from` (not straight-line distance — a neighbor that's geometrically close but behind a
     wall of racks isn't actually cheap to reach). Implemented as "run `findPath` from `from` to
     each walkable neighbor candidate, keep the shortest result" — grid is small enough that a
     handful of A* calls per click is cheap; no need for a fancier multi-target search.

3. **New components** (`src/ecs/components.ts`):
   - `export interface GridCell { gridX: number; gridY: number }` — shared shape for path
     waypoints and pathfinding functions (replaces ad-hoc `{gridX, gridY}` object literals).
   - `export interface PathFollow { path: { x: number; y: number }[]; index: number }` — pixel
     centers (not grid cells) precomputed once when the path is planned, so the follow system
     doesn't need to re-derive centers each frame. `index` is the next waypoint to head for.
   - `export const pathFollows = createComponentStore<PathFollow>();`

4. **`createInputSystem` rewritten to plan a path instead of setting `MoveTarget` directly**
   (`src/ecs/systems/input.ts`), only in the two branches that currently set `MoveTarget`
   (build-mode's placement branch is untouched — it doesn't move the player):
   - Compute `bounds = getFloorGridBounds(renderer.canvas)` once per click (cheap; canvas size
     rarely changes, and this avoids caching invalidation on resize).
   - Determine the player's current grid cell from its `Position` via `worldToGrid`.
   - If the clicked cell is walkable (empty): `findPath` from player cell to clicked cell.
   - If the clicked cell is occupied (the "click a rack" case, and now the general "click any
     occupied cell" case): `findNearestWalkableNeighbor` from the clicked cell, then `findPath` to
     that neighbor cell — this is the "stop in front of the rack" behavior.
   - If a path comes back non-null: convert each `GridCell` to its pixel center
     (`gridX * GRID_CELL_SIZE + GRID_CELL_SIZE / 2`, same for Y) and set
     `world.addComponent(pathFollows, controlled, { path: centers, index: 0 })`, replacing any
     existing `PathFollow`. Also clear any stale `MoveTarget` so a fresh click always fully
     retargets (mirrors the existing "a fresh click always retargets" rule from
     `.plans/player-movement.md`).
   - If `findPath`/`findNearestWalkableNeighbor` return null (nothing reachable): no-op, same as
     today's "click on occupied cell with build mode active" no-op.
   - Build-mode branches (panel hit-testing, placement) are unchanged.

5. **New system: `createPathFollowSystem`** (`src/ecs/systems/path-follow.ts`), inserted between
   input and movement in `main.ts`'s system list:
   - For each entity with `PathFollow` and no current `MoveTarget` (i.e. the movement system just
     finished the previous leg and cleared it, or this is the first tick after planning):
     - If `index < path.length`: set `MoveTarget` to `path[index]`, increment `index`.
     - Else (path exhausted): remove the `PathFollow` component — arrival.
   - This is why `MoveTarget` and `movement.ts` need no changes at all: `PathFollow` just
     re-arms `MoveTarget` leg by leg, reusing the exact same arrival-detection
     (`removeComponent(moveTargets, id)`) the movement system already does.

6. **Wire up in `src/main.ts`**: add `createPathFollowSystem(world)` to the `systems` array,
   after `createInputSystem` and before `createMovementSystem` (path-follow must set this frame's
   `MoveTarget` before movement consumes it the same tick).

7. **No rendering changes required** for correctness, but worth adding for debuggability: not in
   scope unless requested — skip a path-line overlay for now to keep this change focused on
   mechanics, consistent with "don't add features beyond what the task requires."

## Files modified

- `src/ecs/components.ts` — move `BUILDING_MARGIN` here (or wherever step 1 lands it); add
  `GridCell`, `PathFollow`, `pathFollows` store.
- `src/ecs/pathfinding.ts` (new) — `getFloorGridBounds`, `isWalkable`, `findPath`,
  `findNearestWalkableNeighbor`.
- `src/ecs/systems/path-follow.ts` (new) — `createPathFollowSystem`.
- `src/ecs/systems/input.ts` — replace direct `MoveTarget` assignment with path planning in the
  two move-triggering branches.
- `src/ecs/systems/render.ts` — import `BUILDING_MARGIN` from `components.ts` instead of
  redeclaring it locally.
- `src/main.ts` — register `createPathFollowSystem` in the systems array.

## Verification

- `npm run dev`, open in browser: clicking empty floor space walks the player there in a straight
  line same as before (single-leg path, unchanged feel). Clicking a rack that has empty cells
  around it stops the player on the nearest reachable adjacent cell rather than on top of the
  rack. Clicking a point on the far side of a wall of racks routes the player around them rather
  than through them. Clicking a cell that's fully enclosed by racks (no reachable neighbor) is a
  no-op — the player doesn't teleport or freeze mid-animation. Rapid re-clicking mid-path
  immediately replans from the player's current position.
- `npm run lint` and `npm run build` pass cleanly.
