# Datacenter Manager — Project Instructions

## Validation

Do not use Playwright or any browser-automation tool to validate the game after changes. Do not use any other CLI or tool to start the project and validate it. Let me validate it manually later.

## Current phase: implementation

## Role

Act as a senior developer: favor proven, boring solutions over novel ones, call out
trade-offs explicitly, and push back on approaches that won't scale before they're built,
not after.

## Working principles

- **Reuse first.** Before proposing or implementing any module, check whether an existing
  module already covers it. Extend or compose existing code rather than duplicating logic.
- **Modular design.** Structure the game as independent, reusable modules (e.g. rendering,
  input, game loop/state, entities, audio) with clear boundaries and minimal coupling between
  them. A module should be usable or testable on its own.
- **TypeScript throughout.** All game logic is TypeScript; use it to enforce module
  boundaries via types/interfaces, not just for editor hints.
- **Canvas for rendering.** All drawing goes through the Canvas API — no DOM-based rendering
  of game entities.

## Architecture: ECS (entity-component-system)

Game objects are built as ECS, not as objects with behavior. Entities are dumb — plain
numeric IDs with no methods. State lives in components (plain data, no logic). Behavior lives
in systems (plain functions that query components and mutate them each tick). Never add an
`update`/`render` method to an entity or give a component a method — that behavior belongs in
a system.

- Hand-rolled, no ECS library. `Map<EntityId, T>` per component type is enough at this game's
  scale (racks, machines, one player — never thousands of entities); an archetype/query
  library would be solving a performance problem this project doesn't have.
- Lives in `src/ecs/`: `world.ts` (entity IDs, component storage, `query`), `components.ts`
  (component type definitions), `systems/` (one file per system).
  See `.plans/ecs-migration.md` for the full component/system inventory and migration steps.
- New gameplay features are designed ECS-first: new state is a component, new behavior is a
  system, not a new entity subtype or method.

## Game Concept

A top-down 2D datacenter tycoon. The player manages a datacenter: walking the floor between
rows of racks, placing and upgrading machines and network gear, and keeping the facility
running (power, cooling, bandwidth, uptime) while it grows. The core loop is build-and-manage
economy: workloads running on your machines earn money/reputation, which is reinvested into
more racks, machines, and infrastructure, unlocking more capacity and more demanding
workloads. Incident/failure handling (outages, hardware failure, overheating events) is an
intentional later layer, added once this core loop exists — not part of the first feature set.

## First Features

1. **Player movement** — top-down movement around the datacenter floor (grid or free
   movement between rack rows/aisles); the `input` module drives this, `entities` holds the
   player entity.
2. **Datacenter floor & rack placement** — a grid-based floor layout where the player places
   racks in aisles; racks are containers that hold machines.
3. **Machine management** — buying/placing machines into racks, each machine having basic
   attributes (compute capacity, power draw, cost) and running "workloads" that generate
   income.
4. **Resource management** — power and cooling as facility-wide constraints that cap how
   many machines can run; a resource module tracks these against installed capacity.
5. **Network** — connecting racks/machines to network infrastructure (switches/routers) that
   gates bandwidth-dependent workload income; a first-pass abstraction, not a full topology
   sim yet.
6. **Economy loop** — money earned from running workloads, spent on racks/machines/power
   /cooling/network upgrades; ties the above features into the build-and-manage cycle.
7. **HUD / basic UI overlay** — on-canvas or DOM overlay showing money, power usage, and
   basic stats, so the loop is visible to the player.

## Plans

All implementation plans go in `.plans/<plan_name>.md` under the project root — not the
default global plan location. Create the `.plans/` folder if it doesn't exist yet.

## Tooling decision

Build tool/bundler: **Vite**. Chosen over webpack/esbuild/Rollup/Parcel for fast dev-server
startup and near-instant reload on change, minimal config, and native TypeScript support —
all of which matter for a tight edit/see-the-change loop during game development.
