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
- **Single writer per component.** For any given component type, exactly one system may write
  to it; every other system that touches it only reads. If a change seems to need two systems
  writing the same component, that's a signal the behavior belongs in one of them, or that the
  component should be split so each part has a single owner.
- **No cross-system function calls.** Components stay plain data — never attach a function to
  one, and never have a system import and call another system's internal helper to mutate
  shared state. Keep behavior specific to a system's own domain inside that system's file. When
  two systems genuinely need to coordinate on the same mutation, extract the shared logic into
  its own module that both call into (see `dispatch.ts`'s placement helpers) rather than reaching
  into another system's file.
- **Systems hold per-tick behavior only.** If logic isn't itself something that runs as part of
  a system's `update` each tick — pure computation, math, formatting, data transforms — give it
  its own module elsewhere in `src/` (e.g. `components.ts`'s grid math, `dispatch.ts`) instead of
  folding it into a system file for convenience.

## ECS system docs

Before adding or extending a system, check the relevant doc below — it may already cover
the behavior, an ordering dependency, or a shared helper to reuse. See
[docs/ecs-systems/README.md](docs/ecs-systems/README.md) for the update order and core
ECS files.

- [input](docs/ecs-systems/input.md) — pointer/keyboard gesture ownership: build mode, click-priority chain, drag lifecycle entry points
- [movement](docs/ecs-systems/movement.md) — moves an entity's `Position` toward its `MoveTarget`
- [path-follow](docs/ecs-systems/path-follow.md) — feeds a queued path into `MoveTarget` one waypoint at a time
- [camera](docs/ecs-systems/camera.md) — eases the camera toward the controlled entity (render-only)
- [install-progress](docs/ecs-systems/install-progress.md) — walks-to-rack-then-installs flow for a bought machine
- [rack-panel](docs/ecs-systems/rack-panel.md) — rack panel open/close/arrival, scroll, and drag-and-drop resolution
- [shop](docs/ecs-systems/shop.md) — proximity-based shop panel lifecycle and purchase application
- [resource](docs/ecs-systems/resource.md) — power/cooling brownout selection and facility draw totals
- [capacity](docs/ecs-systems/capacity.md) — derived per-server/per-rack/facility free-capacity cache
- [thermal](docs/ecs-systems/thermal.md) — per-rack temperature from local heat and CRAC placement; throttle band and overheat trips
- [workload-spawn](docs/ecs-systems/workload-spawn.md) — offer arrival cadence and offer expiry
- [workload-run](docs/ecs-systems/workload-run.md) — ticks placed/unplaced workloads: payout, completion, deadline miss
- [render](docs/ecs-systems/render.md) — all Canvas drawing of the floor, racks, panels, build UI (presentation only)
- [hud](docs/ecs-systems/hud.md) — top bar, workload panel, offers panel (presentation only)
- [tutorial](docs/ecs-systems/tutorial.md) — first-time guided-tutorial step advance (banner drawn by hud.ts)

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

## Comment discipline

1. **No narration comments.** Don't add comments that describe what the code does when the
   code already makes that obvious (`// increment counter`, `// loop over racks`). Comments
   should only explain why something non-obvious is done — a tricky workaround, a
   non-standard choice, a constraint from an external system.
2. **No references to planning docs, specs, or tickets in code.** Never write comments like
   `// per the plan, this implements X` or `// as discussed in ARCHITECTURE.md, we do Y`.
   Code should be self-contained and read correctly with zero knowledge that a plan/spec
   file exists. If traceability to a plan matters, put that in the commit message or PR
   description — not in the source.
3. **No meta-commentary about the implementation process.** Avoid comments like
   `// added this per requirements`, `// fixing bug from review`,
   `// TODO: revisit after plan phase 2`. These describe the history of the change, not the
   code itself.
4. **Default to no comment.** If you're unsure whether a comment adds value, omit it. Err
   toward clean, readable code with minimal comments rather than over-annotated code.
5. **Docstrings/function-level comments are fine** when they explain a public API's contract
   (inputs, outputs, side effects) — but keep them terse, no plan/spec references there
   either.

```ts
// BAD:
// Per .plans/thermal-tuning.md, we clamp the reading here
const temp = clamp(rawTemp, MIN_TEMP, MAX_TEMP);

// GOOD (only if genuinely non-obvious):
// sensor firmware reports -1 during warmup; treat as room temp, not a real reading
const temp = rawTemp < 0 ? ROOM_TEMP : rawTemp;
```
