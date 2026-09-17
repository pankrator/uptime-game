# Thermal and cooling: making the floor plan matter

> **Plan 9.** Depends on `.plans/facility-shop-inventory.md` (rooms, shop, inventory, camera)
> and the existing `RackLoad.heatKw` rollup in
> [capacity.ts](src/ecs/systems/capacity.ts). Strongly benefits from
> `.plans/time-controls.md` (thermal equilibrium takes simulated minutes to observe).
>
> **This is the highest-value plan in the set and also the largest.** It converts cooling from
> a scalar you buy into a resource you *place*, which is the change that makes this a spatial
> game rather than a menu game with a walking avatar.

## Context

The game is built on a grid. The player walks it, places racks on it, upgrades the room to get
more of it. And yet **no simulation in the game reads position.** `resource.ts` sums every
machine's `coolingKw` into one facility total and compares it against one facility
`CoolingCapacity` ([resource.ts:88-139](src/ecs/systems/resource.ts#L88-L139)). A rack jammed
in a corner behaves identically to one with three empty cells around it.

That means floor layout is currently decoration. The player's only spatial decisions are
"is there a free cell" and "how far do I walk" — neither of which is interesting.

Meanwhile the data model is already most of the way there. `RackLoad { powerKw, heatKw,
serverCount }` is computed **per rack** every tick by `capacity.ts` and rendered under each
rack by `drawRackLoadLabel` ([render.ts:254-273](src/ecs/systems/render.ts#L254-L273)).
Per-rack heat is generated and displayed; it simply has no consequences. And
`.plans/workload-dispatch.md:482` explicitly anticipated this: *"a later change (heat
accumulating locally per rack, hot spots) does not need a data-model change."*

The outcome: each rack has a temperature that rises with its own heat and falls with nearby
cooling. Hot racks throttle, then trip offline. Cooling units are buildings placed on the
floor with a radius of effect. Aisle spacing becomes strategy.

---

## Design decisions

### D1. Temperature lives on the rack, not the machine or the cell

```ts
export interface Temperature { celsius: number }
```

One component, on rack entities. Not per machine (six machines in a rack share an airflow
path — modeling them separately adds six times the state for no decision), and not per cell
(a grid-wide heat field means simulating every cell in a 20×14 room every tick, most of them
empty and at ambient).

Racks are the only heat sources and the only things that can fail from heat. The number of
racks is small — tens, not thousands — so a per-rack model is both cheap and sufficient.

### D2. Temperature is integrated state, not a derived cache

This is the important departure from existing convention. `RackLoad`, `ServerCapacity`, and
`Utilization` are all **fully recomputed from scratch every tick** — the codebase is emphatic
about this discipline, and it is a good one.

`Temperature` cannot follow it. Heat has history: a rack that has been running hot for a
minute is hot *now*, and that fact is not recoverable from this tick's `heatKw`. It must
accumulate across ticks.

So `Temperature` is **owned solely by `thermal.ts`** and mutated incrementally. Write that
rule in a comment on the component, because it is the first component in the codebase that
breaks the recompute-every-tick pattern and a future reader will otherwise assume it is a
cache and "fix" it.

### D3. The thermal model is a first-order approach to a target, not a fluid sim

Per rack, per tick:

```
targetC = AMBIENT_C + (heatKw * HEAT_TO_DEGREES) - (coolingAtRack * COOLING_TO_DEGREES)
celsius += (targetC - celsius) * THERMAL_RESPONSE * dt
```

Three constants, one exponential approach. No airflow direction, no hot/cold aisle
orientation, no neighbor-to-neighbor conduction.

Rejecting neighbor conduction is deliberate and worth stating: it is the obvious "more
realistic" next step, it doubles the model's complexity, it makes the whole floor's
temperature a coupled system that is hard to reason about and harder to debug, and it adds
**no new player decision** that cooling-radius placement does not already create. If racks
influencing each other turns out to be wanted later, the hook is adding a term to `targetC` —
the component and system shape do not change.

`THERMAL_RESPONSE` gives thermal *mass*: a rack does not instantly jump to its target, so
switching off a workload cools it over several seconds, and a brief overload does not
immediately trip it. That lag is what makes the mechanic feel physical rather than like a
threshold check.

### D4. Cooling becomes a placed entity with a radius

New buildable: `CRAC Unit` (computer room air conditioner). It is an entity with
`GridPosition`, `Renderable`, and a new `CoolingUnit { kwOutput, radiusCells }` component.

Cooling delivered to a rack is the sum over all CRAC units of a falloff function of grid
distance:

```ts
function coolingAt(gridX, gridY): number   // sum over units of kwOutput * falloff(distance)
```

Use **linear falloff to zero at `radiusCells`**, not inverse-square. Linear is legible — the
player can see the radius ring and reason about "closer is better, past the ring is nothing".
Inverse-square is more physical and much harder to eyeball.

Rejected alternative — CRAC units cooling a rectangular zone: cheaper to compute and to draw,
but it makes optimal play a tiling puzzle with exact right answers. A radius with falloff makes
placement a judgement about *overlap*, which is more interesting and more forgiving.

### D5. Facility `CoolingCapacity` is the work budget; the per-rack baseline is a flat constant

Do **not** delete `CoolingCapacity` and the `cooling-upgrade` purchasable. But they mean one
thing only: **how much work the datacenter can run at once**. `resource.ts` enforces that as a
brownout cap, exactly parallel to power, and because workloads add `coolingBonusKw` while
machines draw a fixed `powerKw`, it is the budget that governs the player's *workload mix*
(render and training are what consume it) where power governs *fleet size*.

`CoolingCapacity` does **not** feed rack temperature. A rack's temperature is a purely local
thing: a flat `BASELINE_COOLING_KW` of building ventilation, the CRAC units in range, and the
`RackLoad.heatKw` the rack is generating. Nothing facility-wide enters the calculation.

**Superseded:** this decision originally read "demoted to baseline", with
`BASELINE_COOLING_SHARE = 0.5` giving every rack half the facility's `CoolingCapacity`. That is
a unit error, and it is worth spelling out so nobody reintroduces it. `CoolingCapacity` is a
facility-wide budget the brownout system keeps at or above the sum of *every* rack's heat, so
handing each rack half of it made delivered cooling scale with the whole floor while a rack's
own heat stayed rack-sized:

```
target_i = AMBIENT + HEAT_TO_DEGREES * heat_avg * (1 - N/2)     for N similar racks
```

Break-even sat at exactly N = 2. Past that, temperature fell linearly with rack count — a
ten-rack floor read around -450 °C — and a thermal trip was unreachable, since it needed one
rack holding more than half the entire facility's heat. It also made the 350-cost cooling
upgrade strictly dominate the 450-cost CRAC (global, stronger, no running power draw), so CRACs
had no reason to exist.

The replacement keeps both of D5's original motivations. Migration safety: `BASELINE_COOLING_KW`
applies with no CRACs placed, so an existing game stays playable. Teaching order: 0.6 kW covers
a rack of budget boxes or basic servers, so the early game still needs no spatial planning, and
heat starts biting once the player densifies (a rack of blade chassis trips on its own; a rack
running render or training work needs CRACs) — which is what makes CRAC placement a decision.

### D6. Overheating throttles before it trips

Three bands, in `thermal.ts`:

| Band | Condition | Effect |
| --- | --- | --- |
| Normal | `< THROTTLE_C` | none |
| Throttling | `THROTTLE_C … TRIP_C` | work rate scaled down |
| Tripped | `> TRIP_C` | machines in the rack go offline |

Throttling scales `workRemainingSeconds` progress **and pay** — a throttled server does its
work more slowly and earns proportionally less, which is the honest reading of "it is going
slower". Do not slow the work while paying full rate; that makes throttling free.

Why a throttle band at all: an instant trip at a threshold gives the player no warning and no
recovery window, so heat would feel like a random punishment. A throttle band is a visible,
survivable degradation that says "act now" — it converts heat from a cliff into a gradient.

**Tripping reuses the brownout machinery exactly.** `Powered.online = false`,
`offlineCooldown = BROWNOUT_COOLDOWN_SECONDS`, and `unplaceAllOn` returns workloads to the
tray ([resource.ts:51-55](src/ecs/systems/resource.ts#L51-L55)). No new failure path, no new
recovery UI.

### D7. Thermal runs after capacity, before workload-run

Ordering, added to the load-bearing comment in [main.ts:56-71](src/main.ts#L56-L71):

- **after `capacity.ts`** — it needs this tick's `RackLoad.heatKw`.
- **before `workload-run.ts`** — it sets the throttle factor that `workload-run` must apply
  when paying and advancing work.
- **after `resource.ts`** — a machine already offline from a brownout should not also be
  generating heat.

There is a genuine interaction to be careful about: `resource.ts` and `thermal.ts` can both
set `Powered.online`. Keep the rule simple — **`resource.ts` decides power, `thermal.ts` may
only force offline, never force online.** A rack that is thermally tripped stays offline even
if power is available. Express this by having `thermal.ts` write to a separate
`ThermalTrip` marker that `resource.ts` reads as a veto on the following tick, rather than
both systems writing `Powered.online` directly. Two writers to one boolean across two systems
is exactly the bug that takes a day to find.

### D8. Heat must be visible on the floor, or none of this lands

The player cannot plan around an invisible number. Rendering is not polish here, it is the
interface to the mechanic:

1. **Per-cell heat wash** — a translucent color overlay under the racks, blue→orange→red.
2. **Temperature on the rack label** — `drawRackLoadLabel` already draws `🔥 x.xkW`; add
   `xx°C`, colored by band.
3. **CRAC radius rings** — always faintly, and strongly while in build mode placing one.
4. **A throttle/trip badge** on hot racks, plus a HUD alert, reusing whatever the brownout
   alert path does.

---

## Step 1 — constants and components

`game-data.ts`:

```ts
export const AMBIENT_C = 20;
export const HEAT_TO_DEGREES = 6;        // °C added per kW of rack heat at equilibrium
export const COOLING_TO_DEGREES = 6;     // °C removed per kW of cooling delivered
export const THERMAL_RESPONSE = 0.25;    // per second; ~4s to cover 63% of the gap
export const THROTTLE_C = 45;
export const TRIP_C = 65;
export const SUPPLY_AIR_C = 14;          // floor: cooling can't pull a rack below supply air
export const BASELINE_COOLING_KW = 0.6;  // flat per-rack building ventilation (absolute kW)

export interface CoolingUnitDef { id, label, cost, kwOutput, radiusCells, powerKw }
export const CRAC_UNIT: CoolingUnitDef = {
  id: 'crac', label: 'CRAC Unit', cost: 450,
  kwOutput: 3, radiusCells: 3, powerKw: 0.8,
};
```

`powerKw` on the CRAC matters: cooling costs power, so with `.plans/power-billing.md` it costs
money to run. That is the central tension of a real datacenter and it falls out for free.

`components.ts`:

```ts
// OWNED BY thermal.ts. Unlike RackLoad/ServerCapacity/Utilization, this is NOT a
// derived cache — heat has history and is integrated across ticks. Never recompute it
// from scratch. See .plans/thermal-and-cooling.md D2.
export interface Temperature { celsius: number; throttleFactor: number }

export interface ThermalTrip { trippedAt: number }   // marker, rack entities
export interface CoolingUnit { kwOutput: number; radiusCells: number }
```

`throttleFactor` lives on `Temperature` (1.0 normal, →0 at trip) so `workload-run.ts` reads
one number and does not re-derive bands.

## Step 2 — `src/ecs/thermal.ts` (pure math, no ECS)

Same shape as `traits.ts`: pure functions, no world, independently testable.

```ts
export function coolingFalloff(distanceCells: number, radiusCells: number): number
export function targetTemperature(heatKw: number, coolingKw: number): number
export function approachTemperature(currentC: number, targetC: number, dt: number): number
export function throttleFactorFor(celsius: number): number
```

Getting these right in isolation is most of the risk in this plan. Keep them here, not inlined
in the system.

## Step 3 — `src/ecs/systems/thermal.ts`

Per tick:

1. Build the CRAC list once: `world.query(coolingUnits, gridPositions)`.
2. For each rack with `Temperature` and `GridPosition`:
   - `delivered = baseline + Σ unit.kwOutput * coolingFalloff(dist, unit.radiusCells)`
   - `target = targetTemperature(rackLoad.heatKw, delivered)`
   - `celsius = approachTemperature(celsius, target, dt)`
   - `throttleFactor = throttleFactorFor(celsius)`
   - above `TRIP_C` → add `ThermalTrip`; below `THROTTLE_C` → remove it (hysteresis: clear the
     trip at a few degrees *below* `THROTTLE_C`, not at `TRIP_C`, or a rack oscillates).
3. Racks with `ThermalTrip`: set every installed machine `Powered.online = false`,
   `offlineCooldown = BROWNOUT_COOLDOWN_SECONDS`, and `unplaceAllOn`.

Cost is O(racks × cracs) per tick — trivial at this scale, no spatial index needed. Say so in
a comment so nobody optimizes it prematurely.

Register in `main.ts` per D7, with the ordering rationale added to the existing comment.

## Step 4 — `resource.ts` respects the veto

In the `shouldBeOnline` calculation ([resource.ts:108](src/ecs/systems/resource.ts#L108)), a
machine whose rack has `ThermalTrip` is never a candidate. One added condition; no other
change to brownout logic.

## Step 5 — `workload-run.ts` applies the throttle

Where it pays and advances work ([workload-run.ts:31-34](src/ecs/systems/workload-run.ts#L31-L34)):

```ts
const factor = world.getComponent(temperatures, rackIdOf(placement.serverId))?.throttleFactor ?? 1;
wallet.money += workload.payPerSecond * factor * deltaSeconds;
workload.workRemainingSeconds -= deltaSeconds * factor;
```

Getting from a server to its rack is `installedIns.get(serverId).rackId` — already available.

Note the consequence: a throttled workload can now **miss its deadline** because
`deadlineRemainingSeconds` keeps ticking at full rate while work slows. That is the intended
teeth, and it is why the throttle band must be visible.

## Step 6 — CRAC as a purchasable and buildable

- `PURCHASABLES`: add `crac` with `kind: 'stock'`, category `'Cooling'`.
- `BuildableId`: add `'crac'` with `placement: 'empty-cell'`.
- `spawnCoolingUnit` in `entities/index.ts`, mirroring `spawnRack`.
- **Pathfinding:** CRACs are obstacles. `pathfinding.ts` builds its occupancy set from
  `Renderable.kind === 'rack'`; [.plans/pathfinding-collision.md:38](.plans/pathfinding-collision.md)
  already flags this as the hardcoding to fix when new buildables arrive. **Do it here** —
  generalize to a `Blocking` marker component rather than adding a second hardcoded kind.
- `RenderableKind` gains `'crac'`.

## Step 7 — rendering (per D8)

1. `drawHeatOverlay` — before racks, after the floor. For each rack cell and its neighborhood,
   fill a translucent color from `celsius`. Keep alpha ≤ 0.35 so the floor grid stays visible.
2. Extend `drawRackLoadLabel` with `xx°C`, colored green/amber/red.
3. `drawCoolingUnit` plus its radius ring; draw the ring solid while placing in build mode so
   coverage is plannable *before* committing.
4. Throttle/trip badge on the rack, and a HUD alert line.
5. Rack panel header already shows `⚡ x.xkW 🔥 x.xkW` ([render.ts:591](src/ecs/systems/render.ts#L591))
   — add temperature and throttle state there too.

## Step 8 — tuning

With fast-forward, verify the intended progression:

1. **One rack, few servers, baseline only** → sits comfortably under `THROTTLE_C`. Heat must
   not be a problem before the player can buy a CRAC.
2. **A full rack of `dense` blades with no CRAC** → throttles, then trips. This is the
   teaching moment; it must be clearly attributable to heat, not read as a random brownout.
3. **One CRAC adjacent** → recovers to normal.
4. **Six racks packed in a corner vs. spread with a CRAC between them** → measurably different
   temperatures. **This is the pass/fail test for the whole plan.** If packing is not
   punished, `radiusCells`/falloff are wrong.
5. **No oscillation** at the trip boundary (D3's thermal mass plus step 3's hysteresis).
6. Re-tune `POWER_COST_PER_KW_SECOND` if `.plans/power-billing.md` shipped — CRAC `powerKw`
   adds meaningfully to the bill.

---

## Files

| File | Change |
| --- | --- |
| `src/ecs/thermal.ts` | **new** — pure thermal math |
| `src/ecs/systems/thermal.ts` | **new** — integrate temps, throttle, trip |
| `src/ecs/game-data.ts` | thermal constants, `CRAC_UNIT`, purchasable entry |
| `src/ecs/components.ts` | `Temperature`, `ThermalTrip`, `CoolingUnit`, `Blocking`; `BuildableId` |
| `src/ecs/systems/resource.ts` | `ThermalTrip` vetoes online candidacy |
| `src/ecs/systems/workload-run.ts` | apply `throttleFactor` to pay and progress |
| `src/ecs/pathfinding.ts` | `Blocking` marker replaces hardcoded `kind === 'rack'` |
| `src/ecs/systems/render.ts` | heat overlay, temps, CRAC + radius, badges |
| `src/ecs/systems/hud.ts` | overheat alerts |
| `src/entities/index.ts` | `spawnCoolingUnit`; racks get `Temperature` |
| `src/main.ts` | register `thermal` with ordering rationale |

## Trade-offs worth flagging

- **`Temperature` breaks the recompute-every-tick discipline.** Unavoidable (D2), but it is a
  real exception to a rule the codebase otherwise holds absolutely. Comment it loudly.
- **Two systems can take a machine offline.** D7's `ThermalTrip` veto keeps a single writer for
  `Powered.online`, but this is the subtlest part of the plan. If a machine ever gets stuck
  offline forever, look here first.
- **Floor space becomes scarce in a way room tiers were not balanced for.** CRACs occupy cells
  that racks used to. `.plans/machines-and-racks.md:245` anticipated floor scarcity as a
  "natural later addition" — this is it, but re-check `ROOM_TIERS` dimensions, especially the
  6×5 starting closet, which may now be too small to hold a rack *and* a CRAC.
- **This plan is roughly the size of `workload-dispatch.md`.** If it needs splitting, the seam
  is after step 5: steps 1–5 give heat, throttling, and tripping against the *existing*
  facility cooling number, with no new buildable at all. That is a complete, playable increment
  that already makes packing racks dangerous. Steps 6–7 then add placeable cooling as the
  answer to a problem the player has already felt — which is the better teaching order anyway.

## Verification

Per CLAUDE.md: no browser automation, no starting the project from here — manual validation.

1. `npx tsc --noEmit` clean after each step.
2. **Heat rises and settles:** a loaded rack climbs to a stable temperature, not unbounded.
3. **Cooling works:** placing a CRAC adjacent visibly drops the rack's temperature over
   several seconds — not instantly (D3's thermal mass).
4. **Falloff is real:** a CRAC at the edge of its radius helps measurably less than an
   adjacent one.
5. **Throttle before trip:** the rack visibly enters an amber band, work slows, income slows,
   *then* it trips — a player watching can react in between.
6. **Trip recovery:** after cooling, machines come back online and workloads can be re-placed.
7. **No stuck-offline machines** after a trip clears (the D7 risk).
8. **Layout matters (the real test):** packed-corner versus spread-with-cooling produces
   clearly different outcomes for the same hardware.
9. **Pathfinding:** the player walks around CRAC units and cannot clip through them.
