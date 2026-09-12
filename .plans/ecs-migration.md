# ECS migration: replace the `Entity` interface with entity-component-system

## Context

The codebase currently uses an OOP-ish `Entity` interface (`{ update(deltaSeconds), render(context) }`)
implemented per-entity (`createPlayer` in `src/entities/index.ts`) and iterated by `src/core`'s
game loop. This plan replaces that with an **entity-component-system (ECS)** architecture: entities
become plain numeric IDs with no behavior of their own ("dumb" entities), state lives in
components (plain data), and behavior lives in systems (functions that query components and
mutate them). This matches CLAUDE.md's modular-design principle more strictly than the current
approach — systems (movement, rendering, input-handling, later: power, cooling, network,
economy) become independently testable units with no coupling to each other beyond the
components they read/write.

Per the user's direction:
- **Lightweight, hand-rolled ECS** — no external ECS library. Entities are numeric IDs;
  components are plain data stored in per-component-type maps keyed by entity ID; systems are
  plain functions. This fits the project's scale (a few hundred entities at most: racks,
  machines, one player) and CLAUDE.md's "boring, proven solutions" principle — a dependency-free
  approach is easier to reason about and debug than adopting an archetype-based library for a
  game that will never need that scale.
- **Full replacement** — the existing `Entity` interface is retired, not kept alongside the ECS.
  `Player` is migrated to components + systems as part of this plan. The not-yet-implemented
  Floor/Rack feature (`.plans/floor-rack-placement.md`) is re-specified in ECS terms so it's
  built ECS-native from the start rather than migrated twice.

## New module: `src/ecs/`

A new top-level module, matching the existing one-module-per-concern layout
(`core`, `rendering`, `input`, `entities`, `state`):

- **`src/ecs/world.ts`** — the `World`: entity ID allocation/destruction, and typed component
  storage.
  - `createWorld(): World`
  - `World.createEntity(): EntityId` (`EntityId = number`)
  - `World.destroyEntity(id: EntityId): void` — removes the id from every component store.
  - Component storage: one `Map<EntityId, T>` per component type, exposed via a small generic
    helper so adding a new component type doesn't require touching `World`'s core code:
    - `World.addComponent<T>(store: ComponentStore<T>, id: EntityId, value: T): void`
    - `World.getComponent<T>(store: ComponentStore<T>, id: EntityId): T | undefined`
    - `World.removeComponent<T>(store: ComponentStore<T>, id: EntityId): void`
    - `World.query(...stores): EntityId[]` — returns entity IDs present in all given stores
      (simple intersection over `Map` keys; no archetype indexing needed at this scale).
- **`src/ecs/components.ts`** — component type definitions and their `ComponentStore` instances.
  Components are plain interfaces, no methods:
  - `Position { x: number; y: number }`
  - `Velocity { dx: number; dy: number }` (used by movement, expressed as pixels/second in the
    direction of travel; a system computes this from `MoveTarget` each frame rather than storing
    a persistent physics velocity)
  - `MoveTarget { x: number; y: number }` (present only while an entity is walking toward a
    point; removed on arrival)
  - `Speed { pixelsPerSecond: number }`
  - `Renderable { kind: 'player-circle' | 'grid-cell' | 'rack' }` (a tag describing *what* to
    draw; the render system switches on it — keeps drawing code out of components)
  - `GridPosition { gridX: number; gridY: number }` (for grid-snapped entities like racks,
    distinct from pixel-space `Position`)
- **`src/ecs/systems/movement.ts`** — `createMovementSystem(world: World): System`. Each tick:
  queries entities with `Position + MoveTarget + Speed`, advances `Position` toward `MoveTarget`
  by `Speed * deltaSeconds`, and removes `MoveTarget` on arrival (same snap-exact-on-arrival logic
  the current `Player` entity has).
- **`src/ecs/systems/input.ts`** — `createInputSystem(world: World, input: InputState): System`.
  Each tick: reads `input.wasClicked()` + `input.getPointerPosition()` and, for the entity/ies
  that should respond to clicks (initially just the player, later split by the click-ownership
  rule already described in `.plans/player-movement.md` step 3 and `.plans/floor-rack-placement.md`),
  sets/replaces their `MoveTarget` component, or in the floor case, creates a new rack entity at
  the clicked grid cell.
- **`src/ecs/systems/render.ts`** — `createRenderSystem(world: World, renderer: Renderer): System`.
  Each tick: queries entities with `Renderable` (+ `Position` or `GridPosition` depending on
  kind) and draws each according to its `Renderable.kind`. This replaces the per-entity `render`
  method; all drawing logic is centralized in one system instead of scattered per entity type.
- **`System` type**: `interface System { update(deltaSeconds: number): void }` — deliberately
  the same shape systems already had as entities, so `core`'s loop barely changes (see below).

## Changes to existing modules

- **`src/entities/index.ts`**: the `Entity` interface and `createPlayer` are removed entirely.
  Replaced by a plain factory that sets up a player's *components* rather than returning a
  behavior object:
  - `spawnPlayer(world: World, start: { x: number; y: number }): EntityId` — creates an entity
    and attaches `Position` (= `start`), `Speed` (= existing `PLAYER_SPEED` constant), and
    `Renderable` (`{ kind: 'player-circle' }`). No `MoveTarget` until the first click.
  - This module becomes "entity factories" (spawn functions), not "entity behavior" — matches
    the ECS principle that entities are dumb, systems own behavior.
- **`src/core/index.ts`**: `GameLoopDeps.entities: Entity[]` is replaced with
  `systems: System[]`. The loop's tick becomes: `for (const system of systems) system.update(deltaSeconds)`
  once (no separate render pass over `entities` — the render system is just another system in
  the list, ordered last so it draws after all state updates for the frame). `renderer.clear()`
  still happens once per tick before systems run, same as today.
- **`src/state/index.ts`**: unchanged in shape for this plan (still holds `Scene`); the future
  `Rack[]` list from `.plans/floor-rack-placement.md` is superseded — racks become ECS entities
  with `GridPosition` + `Renderable` components instead of a `state.racks` array. When that plan
  is implemented, it should create rack entities via a `spawnRack(world, gridX, gridY): EntityId`
  factory in `src/entities/index.ts`, not push into `GameState`.
- **`src/main.ts`**: constructs `createWorld()`, calls `spawnPlayer(world, ...)`, builds the
  `systems` array (`[createInputSystem(world, input), createMovementSystem(world), createRenderSystem(world, renderer)]`),
  and passes `systems` to `createGameLoop`.
- **`src/rendering/index.ts` and `src/input/index.ts`**: unchanged — `Renderer` and `InputState`
  are consumed by systems exactly as they were consumed by entities before.

## Migration steps (in order)

1. Add `src/ecs/world.ts` (World + component store helpers) with unit tests covering
   create/destroy/add/get/remove/query in isolation — no dependency on the rest of the game.
2. Add `src/ecs/components.ts` with the component interfaces and store instances listed above.
3. Add `src/ecs/systems/movement.ts` and its unit test (given a world with a
   Position+MoveTarget+Speed entity, one `update()` call advances it correctly and clears
   `MoveTarget` on arrival) — this is a direct port of `Player`'s existing movement math, so the
   test can assert the same behavior the current manual/visual verification checked.
4. Add `src/ecs/systems/render.ts` (player-circle case only, for now) and
   `src/ecs/systems/input.ts` (sets `MoveTarget` on click, player-only for now).
5. Replace `Entity`/`createPlayer` in `src/entities/index.ts` with `spawnPlayer`.
6. Update `src/core/index.ts` to loop over `System[]` instead of `Entity[]`.
7. Update `src/main.ts` to wire the world, spawn the player, and build the systems array.
8. Delete the old `Entity` interface and any now-unused imports.
9. When `.plans/floor-rack-placement.md` is implemented, it follows this ECS shape directly
   (grid/rack entities + a floor render/placement system) rather than the `state.racks`
   approach originally described there — that plan's file should be updated to reflect this
   before implementation starts.

## Files to be modified

- New: `src/ecs/world.ts`, `src/ecs/components.ts`, `src/ecs/systems/movement.ts`,
  `src/ecs/systems/render.ts`, `src/ecs/systems/input.ts`.
- Modified: `src/entities/index.ts` (Entity interface removed, `spawnPlayer` added),
  `src/core/index.ts` (Entity[] → System[]), `src/main.ts` (world + systems wiring).
- Unmodified: `src/rendering/index.ts`, `src/input/index.ts`, `src/state/index.ts`.

## Verification

- `npm run dev`: same visual/behavioral result as today — clicking the canvas makes the player
  circle walk to that point and stop exactly there, retargeting on a new click mid-walk.
- Unit tests for `World` (create/destroy/query) and the movement system pass in isolation,
  without a browser/canvas — this is the main payoff of the ECS split: systems are testable
  without DOM/canvas mocking.
- `npm run lint` and `npm run build` pass cleanly.
- No references to the old `Entity` interface remain (`grep -r "interface Entity"` returns
  nothing outside this plan's history).
