# ECS Systems

Documentation for every system in `src/ecs/systems/`. Read this before adding a new
system or extending an existing one, to check whether the behavior you need already
exists and to find the right place in the update order for new logic.

## Core ECS

- **World** (`src/ecs/world.ts`) — hand-rolled ECS core. `EntityId` is a plain number.
  `ComponentStore<T>` wraps a `Map<EntityId, T>`. `World` exposes
  `createEntity`/`destroyEntity`/`hasEntity`/`addComponent`/`getComponent`/`removeComponent`/`query`.
  `query(...stores)` returns entity ids present in all given stores (intersection).
  `destroyEntity` sweeps every store it has ever seen, so removing an entity always
  cleans up its components — callers never need to remove components one by one first.
  Component stores are module-level singletons shared by every `World` instance (only the id
  counter and `entities` set are per-instance) — see the comment on `createWorld` and
  `src/save/test-utils.ts` for what that means for anything that creates more than one `World`
  in the same process.
- **System interface** (`src/ecs/systems/system.ts`) — one method: `update(deltaSeconds: number): void`.
  Every system factory (`createXSystem(...)`) returns an object matching this interface.
- **Components** (`src/ecs/components.ts`) — all component type definitions and their
  `ComponentStore` instances (e.g. `positions`, `workloads`, `rackLoads`). Also owns grid
  math (`worldToGrid`/`gridToWorld`), `GRID_CELL_SIZE`, and the `BUILDABLES` list.
- **Dispatch** (`src/ecs/dispatch.ts`) — the only place workload placement mutates state:
  `checkPlacement`, `placeWorkload`, `unplaceWorkload`, `acceptOffer`, `declineOffer`.
  Systems and input both call into this rather than duplicating the placement invariant
  (`Workload.state` / `PlacedOn` / `ServerCapacity.free` must stay consistent).
- **Save/load** (`src/save/`) — not a system (nothing here runs every tick); `main.ts` calls
  into it directly. `registry.ts` is the extension point: every new persistent component gets
  one line there (`SAVE_COMPONENTS` or `TRANSIENT_COMPONENTS`, enforced by
  `registry.test.ts`'s exhaustiveness check) before it needs a save-format decision made for
  it elsewhere. See `.plans/save-load.md`.

## Update order (see `src/main.ts`)

Systems run in this order every tick; several depend on it (noted below):

**`updateSystems`** (simulation, runs even off-screen):

1. `input` — reads input, mutates build mode / drag state / dispatch requests
2. `maintenance` — advances the player's active install/repair task
3. `path-follow` — turns a queued path into the next `MoveTarget`
4. `movement` — advances `Position` toward `MoveTarget`
5. `rack-panel` — panel open/close, arrival, scroll, pending-drop commit
6. `shop` — proximity-based shop panel open/close
7. `resource` — power/cooling brownout decisions (must run before `capacity`)
9. `thermal` — integrates per-rack `Temperature`, throttles and trips (must run after `capacity` for this tick's `RackLoad.heatKw`, before `wear` and `workload-run`)
10. `wear` — accrues wear and rolls for hardware failure (must run after `resource` and `thermal`)
11. `workload-spawn` — spawns new offers, ticks offer expiry
12. `workload-run` — advances placed workloads, pays out, resolves completion/deadline miss (must run after `capacity` and `thermal`)
13. `effects` — expires `FloatingText`/`Toast` entities spawned by `resource`/`workload-run` (timestamp-based, no ordering dependency)
14. `tutorial` — advances the guided-tutorial step (must run last: reads this frame's mutations from every system above)

**`renderSystems`** (presentation only, skipped when tab hidden):

1. `camera` — eases camera toward the player
2. `render` — draws the floor, racks, panels, build UI
3. `hud` — draws the top bar, workload panel, offers panel

## Systems

- [input](./input.md) — pointer/keyboard gesture ownership: build mode, click-priority chain, drag lifecycle entry points
- [movement](./movement.md) — moves an entity's `Position` toward its `MoveTarget`
- [path-follow](./path-follow.md) — feeds a queued path into `MoveTarget` one waypoint at a time
- [camera](./camera.md) — eases the camera toward the controlled entity (render-only)
- [install-progress](./install-progress.md) — walks-to-rack-then-installs flow for a bought machine
- [rack-panel](./rack-panel.md) — rack panel open/close/arrival, scroll, and drag-and-drop resolution
- [shop](./shop.md) — proximity-based shop panel lifecycle and purchase application
- [resource](./resource.md) — power/cooling brownout selection and facility draw totals
- [capacity](./capacity.md) — derived per-server/per-rack/facility free-capacity cache
- [thermal](./thermal.md) — per-rack temperature from local heat and CRAC placement; throttle band and overheat trips
- [workload-spawn](./workload-spawn.md) — offer arrival cadence and offer expiry
- [workload-run](./workload-run.md) — ticks placed/unplaced workloads: payout, completion, deadline miss
- [effects](./effects.md) — floating text / toast banners: spawn-where-it-happens, expire centrally
- [render](./render.md) — all Canvas drawing of the floor, racks, panels, build UI (presentation only)
- [hud](./hud.md) — top bar, workload panel, offers panel (presentation only)
- [tutorial](./tutorial.md) — first-time guided-tutorial step advance (banner drawn by hud.ts)
- [audio](./audio.md) — synthesized SFX and mute toggle, threaded through several systems as a shared dependency
