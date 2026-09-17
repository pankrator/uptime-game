# Save/load: persisting a game, localStorage now, a backend later

> Depends on nothing; touches `src/ecs/components.ts` (two new marker components),
> `src/entities/index.ts` (tag them on spawn), `src/main.ts` (load-on-continue wiring), and
> adds a new top-level module `src/save/` alongside the existing `core`/`rendering`/`input`/
> `state`/`entities`/`ecs`/`camera`/`audio`/`ui`/`landing` modules. Read this before adding any
> new component to `components.ts` — new persistent state needs exactly one line added to the
> registry this plan introduces (Step 3), and it's a designed decision point, not an
> afterthought.

## Context

There is currently no persistence at all — refreshing the tab loses the game. That's fine
today because CLAUDE.md's feature list stops at the economy loop and HUD; it stops being fine
the moment sessions run longer than a sitting, which they already can (`applyStressPreset` in
`entities/index.ts` exists precisely because building up a facility from scratch is slow).

The ECS shape this project chose ([CLAUDE.md](../CLAUDE.md), `.plans/ecs-migration.md`) is
good news here: **all game state already lives in one place** — the named `ComponentStore`s
exported from `src/ecs/components.ts` (`positions`, `wallets`, `machines`, `workloads`, …
44 stores as of this writing). Nothing is hidden in a class field or a closure. Saving the
game is therefore "walk the component stores, write out the data," not an
object-graph-serialization problem.

Two things this plan takes seriously because the user asked for them explicitly:

1. **Extensible without a rewrite.** New systems keep landing (thermal, wear, contract
   variety, research tree next per `.plans/research-tree.md`) and each one adds new
   components. The save format must absorb "one more component" as a one-line, low-risk
   change — and must not silently *lose* new persistent state just because someone forgot to
   register it.
2. **Backend-ready without premature backend work.** No server exists yet and building one is
   out of scope. But the save code should be written so that "save to our API instead of
   localStorage" is a new ~30-line file, not a rewrite of `serialize.ts`/`deserialize.ts`/
   every call site.

## Design decisions

### D1. Storage is a 4-method interface; localStorage is just today's implementation

```ts
// src/save/types.ts
export interface SaveStorage {
  write(slot: string, data: string): Promise<void>;
  read(slot: string): Promise<string | null>;
  list(): Promise<string[]>;
  remove(slot: string): Promise<void>;
}
```

`data` is the already-JSON-stringified save (the storage layer never touches game shape,
only opaque strings — keeps it trivially reusable for *any* JSON blob, not just saves).
Methods are `Promise`-returning even though `localStorage` is synchronous, so a later
`fetch`-backed implementation is a drop-in with no call-site changes:

```ts
// src/save/local-storage.ts (today)
export function createLocalStorageSaveStorage(prefix = 'uptime-game:save:'): SaveStorage { ... }

// src/save/http-storage.ts (later — not built by this plan)
export function createHttpSaveStorage(baseUrl: string, authToken: string): SaveStorage { ... }
```

Everything above `SaveStorage` (the manager, the UI) depends only on the interface. This is
the entire "plan for a backend" ask — there's no speculative backend code to write now, just
a seam that doesn't require one.

**Trade-off called out:** this doesn't solve multi-device sync, conflict resolution, or auth
— those are real backend-integration problems, not storage-interface problems, and belong in
their own plan once there's an actual backend to integrate with. Building that now would be
solving a problem we don't have yet, which is exactly what CLAUDE.md's "boring, proven
solutions" / no-speculative-design principle says not to do.

### D2. A component registry, not a hand-written (de)serializer

The naive approach — a big function that reads `wallets.map.get(facility)`,
`machines.map.get(id)`, … by name — breaks the extensibility requirement: every new component
needs a matching hand-edit in two places (serialize and deserialize), easy to forget, easy to
get subtly wrong (forget one direction, or forget a ref field).

Instead, one table drives both directions:

```ts
// src/save/registry.ts
interface SaveComponentEntry<T> {
  key: string;               // stable id, independent of the store's TS export name —
                              // renaming `wallets` -> `facilityWallets` later must not
                              // break old saves, so this is hand-picked once, not derived.
  store: ComponentStore<T>;
  // Only needed by components holding another entity's id (InstalledIn.rackId,
  // PlacedOn.serverId, MaintenanceTask.rackId + MaintenanceJob's nested machineId). Default:
  // identity (no refs). See D3.
  remapRefs?: (value: T, remap: (old: EntityId) => EntityId) => T;
}

export const SAVE_COMPONENTS: SaveComponentEntry<any>[] = [
  { key: 'position', store: positions },
  { key: 'gridPosition', store: gridPositions },
  { key: 'renderable', store: renderables },
  { key: 'speed', store: speeds },
  { key: 'roomTier', store: roomTiers },
  { key: 'inventory', store: inventories },
  { key: 'wallet', store: wallets },
  { key: 'reputation', store: reputations },
  { key: 'powerCapacity', store: powerCapacities },
  { key: 'coolingCapacity', store: coolingCapacities },
  { key: 'rackSlots', store: rackSlots },
  { key: 'temperature', store: temperatures },
  { key: 'thermalTrip', store: thermalTrips },
  { key: 'coolingUnit', store: coolingUnits },
  { key: 'machine', store: machines },
  {
    key: 'installedIn',
    store: installedIns,
    remapRefs: (v, remap) => ({ ...v, rackId: remap(v.rackId) }),
  },
  { key: 'powered', store: powereds },
  { key: 'condition', store: conditions },
  { key: 'failed', store: faileds },
  {
    key: 'maintenanceTask',
    store: maintenanceTasks,
    remapRefs: (v, remap) => ({
      ...v,
      rackId: remap(v.rackId),
      job: v.job.kind === 'repair' || v.job.kind === 'decommission'
        ? { ...v.job, machineId: remap(v.job.machineId) }
        : v.job,
    }),
  },
  { key: 'demandClock', store: demandClocks },
  {
    key: 'placedOn',
    store: placedOns,
    remapRefs: (v, remap) => ({ serverId: remap(v.serverId) }),
  },
  { key: 'workload', store: workloads },
  { key: 'offer', store: offers },
  { key: 'tutorialProgress', store: tutorialProgresses },
  { key: 'playerTag', store: playerTags },   // D5
  { key: 'facilityTag', store: facilityTags }, // D5
];
```

Adding a new component to a system now means: add the `ComponentStore` in `components.ts` as
always, then add **one line** here (two if it holds an entity reference). That's the
extension point the user asked for.

**Enforcing it isn't forgotten** (the actual risk with an opt-in list): a test iterates every
`ComponentStore`-shaped export of `components.ts` and asserts it's classified as either
persistent (`SAVE_COMPONENTS`) or explicitly transient (`TRANSIENT_COMPONENTS`, a plain list
of keys with a one-line reason each — see D4). A component that's neither fails the test at
build time, not silently at save time. This is the safety net a duplicated hand-written
serializer doesn't get for free.

### D3. Entity identity is remapped on load, not preserved

`World.createEntity()` (`src/ecs/world.ts`) hands out the next sequential id with no way to
request a specific one. Rather than widen `World`'s public API just for loading, save format
treats entities as an **array**, and any field that references another entity
(`InstalledIn.rackId`, `PlacedOn.serverId`, `MaintenanceTask.rackId`/`.job.machineId`) stores
the *index into that array*, not the live numeric id.

Loading: create one fresh entity per array element (via the normal `world.createEntity()`, in
order) to get an `oldIndex -> newEntityId` map, then hydrate every component via
`SAVE_COMPONENTS`, running each entry's `remapRefs` (D2) against that map. This is why
`remapRefs` exists as a per-component hook rather than a generic "list these field names" —
`MaintenanceTask`'s ref is nested inside a discriminated union (`MaintenanceJob`), which no
generic field-name scheme handles cleanly; a plain function does.

### D4. Persist authored/integrated state; skip derived caches and session-only UI state

Recomputing a value from scratch every tick (the project's own stated pattern —
`RackLoad`/`ServerCapacity`/`Utilization` are explicitly documented as "derived cache" in
`components.ts`) means it's *wrong to save*: it'll be stale the instant another persisted
value changes, and every system that writes it already runs on tick 1 after load. Saving it
anyway is dead weight and a second source of truth to drift.

Conversely, some components are **integrated state with history** — `components.ts` itself
flags `Temperature`, `Condition`, and (implicitly, via cooldown) `Powered` this way, precisely
because their current value can't be reconstructed from this tick's inputs alone. Those must
persist or loading silently resets a hot rack to ambient / a worn machine to new.

Classification (component → decision, from the current `components.ts`):

| Persist | Reason |
|---|---|
| `Position`, `GridPosition`, `Renderable`, `Speed` | identity/placement, not derivable |
| `RoomTier`, `Inventory`, `Wallet`, `Reputation`, `PowerCapacity`, `CoolingCapacity` | facility singleton progression |
| `RackSlots`, `CoolingUnit` | authored at placement time |
| `Temperature`, `ThermalTrip` | integrated (thermal.ts is documented sole owner) |
| `Machine`, `InstalledIn` | identity/placement |
| `Powered` | `offlineCooldown` is integrated (ticks down over real time) |
| `Condition`, `Failed` | integrated (wear.ts is documented sole owner) |
| `MaintenanceTask` | in-flight player task; dropping it on load would silently cancel a walk/repair/install the player paid for |
| `DemandClock` | facility progression clock |
| `PlacedOn`, `Workload`, `Offer` | economy state — the whole point of saving |
| `TutorialProgress` | first-session guidance state |

| Skip (transient/derived) | Reason |
|---|---|
| `MoveTarget`, `PathFollow` | in-flight movement order; safe to resume idle on load |
| `BuildMode` | build-panel selection, UI-only |
| `RackLoad`, `ServerCapacity`, `Utilization` | derived cache, fully recomputed every tick by capacity.ts/resource.ts/workload-run.ts |
| `OpenRackPanel`, `RackScroll`, `ShopOpen`, `PendingDrop`, `DragState`, `DecommissionConfirm`, `RejectedDrop` | session-local UI/gesture state, meaningless across a reload |

This table becomes `SAVE_COMPONENTS` (persist column) and `TRANSIENT_COMPONENTS` (skip
column) verbatim — see D2's exhaustiveness test.

**Bug found post-ship, fixed:** "recomputed every tick" was true for `RackLoad`/
`ServerCapacity` (capacity.ts creates them fresh via `addComponent` every tick, no precondition
on prior existence) but NOT for `Utilization` — resource.ts, capacity.ts, workload-spawn.ts,
hud.ts, and render.ts all *read* `Utilization` off the facility as a precondition (`if
(!utilization) return`) before doing anything, rather than creating it. A fresh game never hit
this because `spawnFacility` always seeds it; a loaded game skips `spawnFacility` entirely, so
the facility had no `Utilization` from the moment of load onward — no system ever wrote one, so
none of them ever ran again. Symptom: HUD top bar never draws after Continue (looks like the
save lost your money), and no new offers ever spawn. Fixed by seeding a fresh
`Utilization` (via the new `defaultUtilization()` in `entities/index.ts`, shared with
`spawnFacility`) onto the facility inside `SaveManager.load()` right after deserializing — the
one place that's true for every caller, not just `main.ts`'s. Regression test:
`src/save/manager.test.ts`.

### D5. Two new marker components find the singletons, instead of hardcoding ids in the save format

The save format is just "an array of entities + their components" — nothing in it says which
entity is the player or the facility. Rather than smuggle that in as out-of-band metadata
(`{ playerIndex: 3, facilityIndex: 0, entities: [...] }`, which breaks the moment there's ever
a second facility or no player entity mid-load), add two marker components, matching the
existing marker-component idiom already used for `Failed`/`ThermalTrip`/`ShopOpen`:

```ts
export interface PlayerTag {}
export interface FacilityTag {}
export const playerTags = createComponentStore<PlayerTag>();
export const facilityTags = createComponentStore<FacilityTag>();
```

`spawnPlayer`/`spawnFacility` (`src/entities/index.ts`) add them alongside everything else
they already set up. After a load, `world.query(playerTags)[0]` / `world.query(facilityTags)[0]`
recover the two ids `main.ts` needs to construct the systems list — the exact same lookup
`main.ts` does today by holding the ids returned from `spawnPlayer`/`spawnFacility` at
creation time, just also reachable after a load where nothing returned them.

### D6. Versioned envelope, additive-by-default, no new runtime dependency

```ts
// src/save/types.ts
export interface SaveEnvelope {
  schemaVersion: number;
  savedAt: number; // Date.now()
  entities: SerializedEntity[]; // SerializedEntity = { components: Record<string, unknown> }
}
```

- **New component added:** no migration needed. Old saves simply don't have that `key` in any
  entity's `components` map; `deserialize.ts` treats a missing key as "component absent,"
  which is already a legal ECS state (plenty of code already does `getComponent(...) ??`
  nothing / an `if` guard).
- **Component removed:** no migration needed. Its entry drops out of `SAVE_COMPONENTS`; any
  leftover key in an old save's JSON is simply never looked up and ignored.
- **Component reshaped** (renamed/restructured field): needs an explicit migration, because
  neither of the above cases apply. Two levels, matching where the change actually happened:
  - **Envelope-level** (`schemaVersion` bump): an ordered list of pure `(raw: unknown) =>
    unknown` functions, one per version step, run sequentially before any component parsing.
    For "rename `Wallet.money` to `Wallet.balance`," even though only one component changed,
    the fix lives here as the simplest option — walk `entities[].components.wallet` and rename
    the field.
  - Per-component `migrate` hooks (mentioned in D2's interface shape but expected to be rare)
    exist only if a component-level migration needs enough isolation that inlining it in the
    envelope migration would be unreadable. Start without using this; add it the first time an
    envelope-level migration function gets uncomfortably large.
- **No `zod`/schema-validation dependency.** The project has zero runtime dependencies today
  (`package.json` — only dev tooling: eslint, prettier, typescript, vite), consistent with
  CLAUDE.md's "boring, proven solutions" steer. The only untrusted input here is
  `localStorage`'s own string (or, later, an HTTP response) — not large, not adversarial
  beyond "a previous version of this same game wrote it, or it's corrupt/foreign JSON." A
  handful of `typeof`/`Array.isArray` guards at the envelope boundary (`schemaVersion` is a
  number, `entities` is an array) are enough; anything that fails them is treated as "no valid
  save" (log a warning, let the caller fall back to a fresh game) rather than thrown as an
  uncaught exception mid-load.

### D7. Where this plugs into the running game

- **Landing screen** (`src/landing/index.ts`, DOM-based — it runs before the ECS
  world/game loop exist at all, per its own header comment): add a **Continue** button,
  shown only when `SaveManager.hasSave()` resolves true, alongside the existing Start / dev
  stress-preset buttons. Its handler calls `SaveManager.load()` into a freshly created
  `World` instead of `main.ts`'s current `spawnFacility`/`spawnPlayer`/`startTutorial` path,
  then proceeds into the same `runGame` wiring.
- **In-game save/load** is UI chrome, not a game entity, but CLAUDE.md's Canvas-only rendering
  rule is about game entities specifically, and every existing in-game panel (shop, rack,
  offers, tutorial banner) is already a Canvas-drawn panel with hit-testing in
  `src/ecs/systems/input.ts` and geometry in `src/ui/layout.ts` — not a DOM overlay. A pause/
  save panel should follow that exact precedent (new rects in `ui/layout.ts`, drawn by
  `hud.ts`, hit-tested in `input.ts`) rather than introduce a second, DOM-based UI pattern
  into the game proper. This reuses the already-declared-but-currently-unused `'paused'`
  `Scene` (`src/state/index.ts`).
- **Manual save** is a menu action calling `SaveManager.save(world)`. **Autosave** (interval-
  based, to a reserved slot separate from manual ones) is a natural fit for the existing
  system pattern — a `createAutosaveSystem(world, saveManager)` ticking a timer and calling
  `SaveManager.save()` every N seconds, added to `updateSystems` in `main.ts` like any other
  system — but is a **follow-up**, not required for a working save/load loop. Called out
  explicitly in Non-goals below so it isn't quietly assumed as part of this plan's scope.

## Non-goals for this plan (explicitly out of scope)

- ~~Multiple named save slots and slot-management UI~~ — **done as a follow-up**: 5 fixed
  slots (`SAVE_SLOT_IDS` in `src/save/manager.ts`, `slot-1`..`slot-5`), a `DEV_SLOT` reserved
  for the dev stress-preset button, and a slot-picker landing screen (`src/landing/index.ts`)
  offering Continue/New Game per slot, confirming before New Game overwrites an occupied one.
  Exactly the "UI-only change later" this line predicted — `SaveStorage`/`serialize.ts`/
  `deserialize.ts` were untouched; only `manager.ts` (added `describeSlots`, dropped the single
  `MANUAL_SLOT` default), `landing/index.ts`, and `main.ts`'s wiring changed. `'autosave'`
  remains reserved and still unwritten.
- Autosave itself (D7) — same reasoning: it's additive once manual save/load works, and
  shipping it alongside a first pass just increases the surface to get right at once.
- Cloud sync, multi-device conflict resolution, auth — genuinely a backend-integration
  problem, deferred until there's a backend to integrate with (D1).
- Save compression/encryption — a localStorage save of this game's state is small (tens of
  entities); not worth the complexity until proven otherwise.
- Exhaustively tested migrations for every historical schema version — the mechanism (D6)
  is built for it, but only `schemaVersion: 1` exists at ship time, so there's nothing to
  migrate *from* yet.

## Steps

1. **`components.ts`**: add `PlayerTag`/`FacilityTag` marker components + stores (D5).
   **`entities/index.ts`**: tag them in `spawnPlayer`/`spawnFacility`.
2. **New module `src/save/`**:
   - `types.ts` — `SaveStorage`, `SaveEnvelope`, `SerializedEntity`.
   - `local-storage.ts` — `createLocalStorageSaveStorage(): SaveStorage` (D1).
   - `registry.ts` — `SAVE_COMPONENTS` + `TRANSIENT_COMPONENTS` (D2, D4).
   - `serialize.ts` — `serializeWorld(world: World): SaveEnvelope`: collect the union of
     entity ids across every `SAVE_COMPONENTS` store, assign array indices, emit each
     entity's persisted components (running `remapRefs` old-id → array-index).
   - `deserialize.ts` — `deserializeWorld(envelope: SaveEnvelope, world: World): void`:
     create entities in array order, build the index → new-id map, hydrate components
     (running `remapRefs` array-index → new-id).
   - `migrations.ts` — `CURRENT_SCHEMA_VERSION`, ordered migration list (D6), starts empty.
   - `manager.ts` — `createSaveManager(storage: SaveStorage)` exposing `save(world, slot?)`,
     `load(world, slot?)`, `hasSave(slot?)`, `deleteSave(slot?)`; owns running migrations
     before deserializing and stamping `schemaVersion`/`savedAt` on save.
3. **Tests** (co-located `*.test.ts`, or wherever the project's existing tests live — none
   exist yet per this repo's current state, so this also establishes the pattern):
   - Exhaustiveness: every `ComponentStore`-typed export of `components.ts` appears in
     exactly one of `SAVE_COMPONENTS`/`TRANSIENT_COMPONENTS` (D2's safety net).
   - Round-trip: spawn a facility + a rack + a machine + a running workload, serialize,
     deserialize into a second fresh `World`, assert the rehydrated component values (and
     remapped references — installed-in rack id, placed-on server id) match.
4. **Wire into `main.ts`**: `runGame` gains a variant that takes a `SaveEnvelope` instead of
   calling `spawnFacility`/`spawnPlayer`/`startTutorial`, and recovers `player`/`facility`
   via the new tags (D5) after `deserializeWorld`.
5. **Landing screen**: `Continue` button, conditional on `SaveManager.hasSave()` (D7).
6. **Docs**: once implemented, add a short "Save/load" line to
   `docs/ecs-systems/README.md`'s "Core ECS" list pointing at `src/save/`; if Step 7's
   autosave system is built, give it its own `docs/ecs-systems/autosave.md` per this
   project's one-doc-per-system convention.
7. **Follow-up (separate, later plan)**: autosave system, in-game pause/save panel (D7),
   multiple named slots, `createHttpSaveStorage` backend adapter (D1).
