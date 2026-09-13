# Machines and racks: buying hardware and walking it into place

> **Plan 1 of 3.** Sequel plans: `.plans/workload-economy.md` (the simulation that makes
> machines earn), `.plans/hud-and-escalation.md` (making it visible and endless).
> This plan deliberately ships *before* any income exists — you spend, you install, you see
> machines light up, and money only goes down. That's a complete, judgeable state.

## Context

Racks today are inert: a `GridPosition` plus a sprite. `spawnRack` adds nothing else, and
`drawRack` paints six slats with a hardcoded LED color cycle that has no relationship to any
data. There is no money, so nothing has a price.

This plan gives racks **capacity**, introduces **machines** that occupy slots, and makes
acquiring one a physical act: you buy it (instant), then the manager **walks to the rack and
installs it** over a few seconds. That walk is what makes the existing pathfinding matter to
the economy rather than being a movement demo.

It also does the structural work the next two plans depend on, so they can be mostly additive:
splitting `components.ts`, adding the game-data module, and restructuring the input chain.

### What "done" looks like

Racks cost $120 and show six visibly empty slots. Two machine tiers are purchasable. Selecting
a machine and clicking a rack deducts money, paths the manager there, shows a progress ring,
and drops a machine into the lowest free slot with a lit LED. Full racks reject the click.
Clicking during an install cancels and refunds. Money never goes up — that's plan 2.

---

## Step 1 — `src/ecs/game-data.ts` (new)

Pure data and pure functions. **No `World` import** — this module must stay trivially
readable and, later, trivially testable.

```ts
export type MachineTierId = 'basic' | 'dense';

export interface MachineTierDef {
  id: MachineTierId;
  label: string;
  cost: number;
  compute: number;
  powerKw: number;
  coolingKw: number;
  installSeconds: number;
}

export const MACHINE_TIERS: Record<MachineTierId, MachineTierDef> = {
  basic: {
    id: 'basic', label: 'Server', cost: 250,
    compute: 10, powerKw: 0.4, coolingKw: 0.3, installSeconds: 3.0,
  },
  dense: {
    id: 'dense', label: 'Blade Chassis', cost: 900,
    compute: 45, powerKw: 1.6, coolingKw: 1.4, installSeconds: 4.5,
  },
};

export const RACK_COST = 120;
export const RACK_SLOT_CAPACITY = 6;

export const POWER_UPGRADE_COST = 400;
export const POWER_UPGRADE_KW = 5;
export const COOLING_UPGRADE_COST = 350;
export const COOLING_UPGRADE_KW = 5;

export const STARTING_MONEY = 750;
export const STARTING_POWER_KW = 3;
export const STARTING_COOLING_KW = 3;
export const STARTING_REPUTATION = 50;
```

**A `Record`, not an array** — every lookup in this plan is by id (`MACHINE_TIERS[tierId]`),
and a `const` object keyed by a string-literal union gives exhaustiveness for free.
`erasableSyntaxOnly` rules out enums, so this is the idiom throughout.

`RACK_SLOT_CAPACITY = 6` is deliberately the same 6 the renderer already hardcodes as
`RACK_UNIT_COUNT`. One constant, shared by the data model and the renderer — the slats stop
being decoration and become the actual slot display.

**Tier tuning note.** `basic` is 25 compute/kW at $25/compute; `dense` is 28.1 compute/kW at
$20/compute — better on *both* axes. That's intentional and needs no nerf: `dense` costs 3.6×
up front for one slot, so early on, when cash is the binding constraint, `basic` is correct;
later, when slots and floor space bind, `dense` is correct. The tension is cash flow vs.
density, which is the real tension in the domain.

---

## Step 2 — `src/ui/layout.ts` (new)

All screen-space UI geometry moves here, so `components.ts` can go back to being components
plus grid math. Plan 3 adds HUD rects to this same file.

Move verbatim from `components.ts`: `BUILD_PANEL_MARGIN`, `BUILD_PANEL_ENTRY_WIDTH`,
`BUILD_PANEL_ENTRY_HEIGHT`, `BUILD_PANEL_ENTRY_GAP`, `getBuildPanelEntryRect`.

Add:

```ts
export interface Rect { x: number; y: number; width: number; height: number }

export function pointerInRect(point: { x: number; y: number }, rect: Rect): boolean {
  return (
    point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height
  );
}
```

`hitTestPanel` in `input.ts` currently inlines that comparison; replace it with
`pointerInRect`. Every region added later hit-tests through the same function.

**Two constraints to preserve.** `getBuildPanelEntryRect` takes `canvasHeight` as a parameter
rather than reading the canvas, because `createRenderer` mutates `canvas.width/height` on
resize with no re-layout — **never cache a layout rect**, compute it every frame. And it
already derives its height from `BUILDABLES.length`, so growing the panel from 1 to 5 entries
needs no layout change at all.

`getBuildPanelEntryRect` will need to import `BUILDABLES` from `components.ts`. That's a
`ui → ecs` dependency, which is the correct direction (UI knows about game data; game data
must not know about UI). Do **not** let anything in `src/ecs/` import from `src/ui/` except
the two systems that draw — `render.ts` and, later, `hud.ts` — and `input.ts` for hit-testing.

---

## Step 3 — Components (`src/ecs/components.ts`, modified)

Remove the build-panel block (moved to `ui/layout.ts`). Add `gridToWorld`, the inverse of the
existing `worldToGrid`, which `input.ts` currently open-codes when computing a neighbor cell's
center:

```ts
export function gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: gridX * GRID_CELL_SIZE + GRID_CELL_SIZE / 2,
    y: gridY * GRID_CELL_SIZE + GRID_CELL_SIZE / 2,
  };
}
```

New components for this plan:

```ts
// Facility singleton (plan 2 adds the rest)
export interface Wallet { money: number }
export interface Reputation { value: number }
export interface PowerCapacity { kw: number }
export interface CoolingCapacity { kw: number }

// Racks
export interface RackSlots { capacity: number }

// Machines
export interface Machine { tierId: MachineTierId }
export interface InstalledIn { rackId: EntityId; slotIndex: number }
export interface Powered { online: boolean; offlineCooldown: number }

// Install interaction (attached to the player)
export interface InstallTask {
  rackId: EntityId;
  tierId: MachineTierId;
  slotIndex: number;
  secondsRemaining: number;
  totalSeconds: number;
  arrived: boolean;
}
```

Plus stores at the bottom, matching the existing convention:

```ts
export const wallets = createComponentStore<Wallet>();
export const reputations = createComponentStore<Reputation>();
export const powerCapacities = createComponentStore<PowerCapacity>();
export const coolingCapacities = createComponentStore<CoolingCapacity>();
export const rackSlots = createComponentStore<RackSlots>();
export const machines = createComponentStore<Machine>();
export const installedIns = createComponentStore<InstalledIn>();
export const powereds = createComponentStore<Powered>();
export const installTasks = createComponentStore<InstallTask>();
```

`components.ts` will need `import { type EntityId } from './world'` (it currently imports only
`createComponentStore`).

### Three design decisions worth not re-litigating later

**Machines get no `GridPosition`.** `isWalkable` treats *any* entity with a `GridPosition` as
blocking a cell. A machine inside a rack would be a second blocker on an already-blocked cell
and would make `isGridCellOccupied` ambiguous — "is there a rack here, or just a machine?".
Machines are located by `InstalledIn`, and the renderer derives their pixel position from the
rack's grid cell plus `slotIndex`.

**`RackSlots` holds `capacity` only — no `used` counter.** Occupancy is derived by scanning
`installedIns` for `rackId === thisRack`. A counter would be a second source of truth that
`world.destroyEntity` — which blindly deletes from every registered store — would silently
desync. At this scale (tens of machines) the scan is free, and there is exactly one place the
truth lives.

**The child holds the parent reference,** for the same reason: a `machineIds: EntityId[]` on
the rack would be left holding dangling ids after any `destroyEntity`.

**`Powered` is introduced here but inert.** Machines spawn `{ online: false, offlineCooldown: 0 }`
and nothing flips it — that's plan 2's `resource` system. It's defined now so `spawnMachine`
and the renderer don't need touching later. In this plan, machines render as *offline* until
plan 2 lands; that's honest, and it means the red-LED path gets exercised early.

---

## Step 4 — Buildables with cost and placement kind

The existing build branch is `if (!isGridCellOccupied(...)) spawnRack(...)`. Installing a
machine needs the **opposite** predicate — the cell must contain a rack with a free slot. And
power/cooling upgrades target nothing at all. Three incompatible behaviors behind one code
path is how that function rots, so each buildable declares what it targets:

```ts
export type PlacementKind = 'empty-cell' | 'rack' | 'purchase';

export type BuildableId =
  | 'rack' | 'machine-basic' | 'machine-dense' | 'power-upgrade' | 'cooling-upgrade';

export interface BuildableDef {
  id: BuildableId;
  label: string;
  cost: number;
  placement: PlacementKind;
}

export const BUILDABLES: BuildableDef[] = [
  { id: 'rack',            label: 'Rack',       cost: RACK_COST,            placement: 'empty-cell' },
  { id: 'machine-basic',   label: 'Server',     cost: MACHINE_TIERS.basic.cost, placement: 'rack' },
  { id: 'machine-dense',   label: 'Blades',     cost: MACHINE_TIERS.dense.cost, placement: 'rack' },
  { id: 'power-upgrade',   label: '+5kW Power', cost: POWER_UPGRADE_COST,   placement: 'purchase' },
  { id: 'cooling-upgrade', label: '+5kW Cool',  placement: 'purchase',      cost: COOLING_UPGRADE_COST },
];
```

**Power and cooling are purchases, not floor objects.** They have no spatial meaning yet, and
making them placeable would need new renderables, grid-blocking semantics, and — the real
objection — would put them in competition with racks for floor space. That's a *third*
constraint stacked on power and cooling, too many for a first cut. As a `'purchase'` kind that
fires on panel click they're about ten lines. Placeable generators and CRAC units are a
natural later addition, once floor space itself is scarce enough to be interesting.

---

## Step 5 — Entity factories (`src/entities/index.ts`, modified)

```ts
export function spawnFacility(world: World): EntityId          // wallet, reputation, capacities
export function spawnRack(world: World, gridX, gridY): EntityId // + RackSlots
export function spawnMachine(
  world: World, rackId: EntityId, tierId: MachineTierId, slotIndex: number,
): EntityId                                                     // Machine, InstalledIn, Powered
```

`spawnMachine` adds **no `Renderable`** — machines are drawn by the rack that contains them,
not as independent renderables. This keeps them out of the `render.ts` `kind !== 'rack'`
filter loops, which are stringly-typed with no exhaustiveness check; not adding a case to them
is a small win.

`spawnFacility` reads its starting values from `game-data.ts` and adds `Wallet`, `Reputation`,
`PowerCapacity`, `CoolingCapacity`. Plan 2 extends it with `Utilization` and `DemandClock`.

### Why the facility is an entity, not `GameState`

Money, reputation, and capacities are facility-wide scalars mutated by several systems per
tick — exactly what a component is for. `GameState` holds only `scene` and is **not passed to
any system**: `createGameLoop` destructures `input` and `state` away and never uses them.
Putting the economy there would mean threading a second mutable container through every system
factory in parallel to `World` — precisely the "second parallel state container" that
`.plans/build-panel.md` rejected when it chose `BuildMode` as a component.

So `main.ts` does `const facility = spawnFacility(world)` and passes `facility: EntityId` to
systems the same way it already passes `player`. `GameState` is untouched by all three plans.

---

## Step 6 — Input restructuring (`src/ecs/systems/input.ts`, modified)

This is the riskiest change in the plan — it rewrites the click-priority chain that every
existing interaction depends on. It is isolated in plan 1 on purpose.

The new chain, highest priority first:

1. **Install in progress → any click cancels and refunds.** New top branch. Without it, a
   misclick strands the manager mid-walk for several seconds with no recourse. Remove
   `InstallTask`, refund `MACHINE_TIERS[task.tierId].cost` to the wallet, clear
   `pathFollows`/`moveTargets`, return.
2. **Panel hit** — toggle off if it's the selected entry, otherwise select. For `'purchase'`
   buildables, apply immediately if affordable and **do not enter build mode** (there's
   nothing to place).
3. **Build mode active** — dispatch on `placement`:
   - `'empty-cell'` → `tryPlaceOnEmptyCell` (today's behavior: place if unoccupied, **stay in
     build mode** so a row of racks can be laid out quickly).
   - `'rack'` → `tryInstallIntoRack`, then **exit build mode** — each install requires a walk,
     so repeat-placement makes no sense here.
4. **No build mode** — `moveControlledTo(world, renderer, controlled, pointer)`, unchanged.

**Affordability gates on the floored wallet value:** `Math.floor(wallet.money) >= cost`. Plan
2 accumulates fractional income, and the HUD displays `Math.floor`. If the gate used the raw
value, a player could see `$250` and be told they can't afford a $250 machine — a bug report,
not a rounding detail. What you see is what you can buy.

`tryInstallIntoRack(world, renderer, controlled, facility, tierId, gridX, gridY)`:

```
find the rack entity at (gridX, gridY) — query(rackSlots, gridPositions)   → none? no-op
scan installedIns for the lowest free slotIndex < capacity                 → full? no-op
deduct cost from the wallet immediately
moveControlledTo(world, renderer, controlled, gridToWorld(gridX, gridY))
addComponent(installTasks, controlled, { rackId, tierId, slotIndex,
  secondsRemaining: installSeconds, totalSeconds: installSeconds, arrived: false })
```

**`moveControlledTo` is reused verbatim.** A rack cell is never walkable, so its existing
"clicked an obstacle → route to the nearest walkable neighbor, aim at that cell's center"
branch is exactly the behavior an install needs. No new pathfinding code, and no special-casing
inside it.

**Money is deducted at click, not at completion.** The refund-on-cancel branch makes this
symmetric, and it means the player can't queue an install, spend the money elsewhere, and get
a free machine.

**Reject the click if an `InstallTask` already exists** — one install at a time. (Branch 1
already consumed such clicks, so this is defense in depth rather than reachable today.)

Also add a **HUD click-swallow** guard: a click landing on HUD chrome returns without walking
the player to a point underneath it. Plan 3 defines the rects; add the branch there, or add it
now returning `false` from a stub `pointerInHud`.

### The `wasClicked()` constraint — designed around, not mitigated

`input.wasClicked()` is consume-on-read with a single consumer per frame. If a second system
called it, whichever ran first would silently eat the click. **All hit-testing stays in
`createInputSystem`**; the HUD (plan 3) is strictly non-interactive. If a future feature needs
a clickable HUD element, the correct fix is splitting `wasClicked()` into a consuming
`consumeClick()` and a non-consuming `isClickPending()` — not adding a second consumer.

---

## Step 7 — `install-progress` system (`src/ecs/systems/install-progress.ts`, new)

```ts
export function createInstallProgressSystem(world: World, controlled: EntityId): System
```

Per frame, if `controlled` has an `InstallTask`:

- **Not arrived:** compare the player's `Position` against the rack cell's center
  (`gridToWorld`). Within `INSTALL_REACH_PX = GRID_CELL_SIZE * 1.2` → set `arrived = true` and
  clear `pathFollows` + `moveTargets`. The reach is deliberately generous: the path is
  string-pulled and ends at a *neighbor* cell's center, roughly one cell away, and a strict
  radius would hang the install forever.
- **Arrived:** decrement `secondsRemaining`. At `<= 0`, call
  `spawnMachine(world, rackId, tierId, slotIndex)` and remove the `InstallTask`.

**Ordering: this system runs *before* `path-follow` and `movement`.** It therefore detects
arrival using last frame's position — one frame of latency, invisible at 60fps, and simpler
than the alternative (running after movement means reasoning about whether `path-follow` has
already re-armed a `MoveTarget` this frame that you now have to unwind).

**Re-validate the slot at completion.** Nothing else can install during a task today, but a
cheap `if the slot is now occupied, pick the next free one; if the rack is gone, refund`
check costs three lines and makes the system robust to plan 2's brownout logic and anything
later that destroys entities.

---

## Step 8 — Rendering (`src/ecs/systems/render.ts`, modified)

**Slot-aware racks.** `drawRack` gains a `slots: SlotState[]` parameter:

```ts
type SlotState = 'empty' | 'online-idle' | 'online-busy' | 'offline';
```

Colors replace the hardcoded `RACK_LED_COLORS` cycle (delete it), and `RACK_UNIT_COUNT`
becomes `RACK_SLOT_CAPACITY` imported from `game-data.ts`:

| State | Slat fill | LED |
|---|---|---|
| `empty` | dark (`#22262b`, today's) | **none** |
| `online-idle` | lighter (`#2e343b`) | amber `#f7b731` |
| `online-busy` | lighter (`#2e343b`) | green `#3ddc84` |
| `offline` | dark | **red `#e5484d`** |

An empty rack should *look* empty — that's the immediately visible difference from today,
where every rack shows the same six lit slats regardless of contents. `'online-busy'` is
unreachable until plan 2 assigns workloads; wire the state now so plan 2 is a one-line change
to the state derivation.

**Build the rack→machines map once per frame**, at the top of `render.update()`:

```ts
const machinesByRack = new Map<EntityId, EntityId[]>();
for (const id of world.query(machines, installedIns)) { /* push into bucket */ }
```

Scanning `installedIns` per rack instead would be O(racks × machines) for the same amount of
code.

**Install indicator**, drawn between racks and the player:
- Walking (`arrived === false`) → pulsing amber outline on the target rack cell, so the
  destination is unambiguous.
- Installing (`arrived === true`) → arc progress ring over the rack cell, from
  `1 - secondsRemaining / totalSeconds`.

Pulse via `Math.sin(performance.now() / 300)` — no state, no component, no timer.

**Build panel entries show cost** (`Rack  $120`) and **dim when unaffordable**, reading the
wallet. This is the only economic feedback until plan 3's HUD, so it carries real weight —
without it, plan 1 has no way to show the player their money at all. Consider a temporary
money readout in the top-left; plan 3 replaces it with the real HUD.

Draw order (painter's, by code order — no z-sort, consistent with today):
building → racks → install indicator → player → build panel.

---

## Step 9 — Wiring (`src/main.ts`, modified)

```ts
const facility = spawnFacility(world);
const player = spawnPlayer(world, { x: canvas.width / 2, y: canvas.height / 2 });

// ORDER IS LOAD-BEARING — see .plans/machines-and-racks.md and .plans/workload-economy.md.
// install-progress runs before movement (detects arrival on last frame's position).
const systems = [
  createInputSystem(world, input, renderer, player, facility),
  createInstallProgressSystem(world, player),
  createPathFollowSystem(world),
  createMovementSystem(world),
  createRenderSystem(world, renderer, player, facility),
];
```

**Put that comment in.** System ordering is exactly the kind of constraint that breaks
silently and confusingly when someone reorders the array for tidiness. Plan 2 adds four more
systems with harder ordering requirements.

---

## Files

### New
| File | Contents |
|---|---|
| `src/ecs/game-data.ts` | machine tiers, costs, starting constants |
| `src/ui/layout.ts` | `Rect`, `pointerInRect`, build-panel layout (moved) |
| `src/ecs/systems/install-progress.ts` | arrival detection, install timer, machine creation |

### Modified
| File | Change |
|---|---|
| `src/ecs/components.ts` | new components + stores; `gridToWorld`; extended `BuildableDef`; **remove** panel layout |
| `src/entities/index.ts` | `spawnFacility`, `spawnMachine`; `spawnRack` gains `RackSlots` |
| `src/ecs/systems/input.ts` | cancel-refund branch, affordability gate, `PlacementKind` dispatch, `pointerInRect` |
| `src/ecs/systems/render.ts` | slot-aware `drawRack`, install indicator, costs in panel |
| `src/main.ts` | `spawnFacility`, thread `facility`, install system, ordering comment |

Unchanged: `state/`, `rendering/`, `input/`, `ecs/world.ts`, `ecs/pathfinding.ts`,
`movement.ts`, `path-follow.ts`, `core/index.ts`.

**Style:** `import { type X }` (`verbatimModuleSyntax`); no enums (`erasableSyntaxOnly`) — use
string-literal unions plus `const` objects; no file extensions in imports; 100 cols, single
quotes, semicolons, trailing commas. Note `tsconfig` has **no `strict`/`strictNullChecks`** —
existing code only *behaves* strict via `!` assertions. Match the style; don't expect the
compiler to catch a missed null check.

---

## Risks

- **The input rewrite touches every existing interaction.** Rack placement, movement, panel
  toggle, and Esc-cancel must all still work. Verification below re-tests them explicitly
  rather than assuming.
- **`isWalkable` scans the whole `gridPositions` store per probe** — allocating an array, ~4×
  per A\* node plus once per quarter-cell line-of-sight step. Machines have no `GridPosition`,
  so this plan doesn't worsen it per entity, but it does encourage building many more racks.
  Don't fix preemptively; when it bites, a `Map<string, EntityId>` occupancy index rebuilt per
  path request is ~20 lines localized to `pathfinding.ts`.
- **No tests, and no framework installed.** Keep `game-data.ts` free of `World` and keep slot
  selection as a pure function over plain data, so it's testable the day a framework lands and
  reviewable by reading today.

## Verification

Manual only — no browser automation, per CLAUDE.md. `npm run lint` and `npm run build` clean.

1. Build panel shows five entries with costs; unaffordable ones are dimmed.
2. Placing a rack deducts $120 and **stays in build mode** — a second click places another.
3. A rack renders six visibly **empty** slats (no LEDs), distinct from today's lit ones.
4. Esc and re-clicking the selected entry both cancel build mode. *(regression)*
5. With no build mode, clicking the floor walks the player; clicking a rack walks them
   adjacent. *(regression)*
6. Select "Server", click a rack → money deducts at once, amber outline on the rack, manager
   paths to it, progress ring on arrival, machine appears in slot 0 with an LED. Build mode
   exits.
7. Installing into the same rack repeatedly fills slots 0..5 in order; the 7th attempt no-ops
   with no charge.
8. Clicking a machine at an empty cell, or a rack with the Rack buildable selected, no-ops
   with no charge.
9. Clicking anywhere during an install cancels it and refunds the exact cost.
10. Power/cooling upgrade entries deduct money on click without entering build mode.
11. Machines render as **offline (red LED)** — correct for this plan; plan 2 brings them
    online.
