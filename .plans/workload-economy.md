# Workload economy: contracts, income, and the capacity wall

> **Plan 2 of 3.** Depends on `.plans/machines-and-racks.md` (facility singleton, machines,
> `Powered`, `game-data.ts`). Followed by `.plans/hud-and-escalation.md`, which makes all of
> this visible and makes the difficulty curve real.
>
> This plan closes the loop: **money goes up**. It is pure simulation — four systems, no new
> interaction, minimal rendering. Plan 3 is where you can *see* it properly; until then you
> read the state off the rack LEDs and the temporary money readout.

## Context

After plan 1 the player can buy racks, buy machines, and walk them into place — and watch
their money drain to zero for no return. Machines have compute, power draw, and cooling draw
recorded as data that nothing reads.

This plan adds the thing that makes those numbers mean something: **a stream of workload
contracts that arrive on their own, auto-assign to free compute, and pay per second while they
run.** And the thing that stops it being a pure upward curve: **power and cooling as
facility-wide capacity, with machines going dark when you exceed it.**

### The purpose of the game

> **The datacenter must support a stream of incoming workloads that never stops growing.**

Money and capacity are the means; keeping up with demand is the point. There is no win screen
and no game over. The tension is a race — demand grows on a timer, capacity grows only as fast
as you can earn, walk, and install. Failure is soft: an unserved contract expires and
reputation drops, which slows future arrivals (a partial mercy, and a visible scoreboard).

```
workload contract arrives (escalating size/frequency)
  ├─ enough free compute? → auto-assigns to machines, pays $/sec for its duration
  └─ not enough?          → sits pending; grace ticks down; expires → reputation drops
                              ↓
           money buys machines → player WALKS to a rack and installs one (takes seconds)
                              ↓
           more machines → more power + cooling draw → hit a capacity wall
                              ↓
           buy power/cooling upgrades → more headroom → serve bigger workloads
                              ↓
                          (demand keeps escalating — endless)
```

**Auto-assignment is a deliberate choice.** The player's job is building capacity, not
playing dispatcher. Manual assignment would add a whole selection UI to make the player
execute an algorithm they'd run identically every time.

---

## Step 1 — Extend `game-data.ts`

Add workload archetypes and the pure functions governing escalation. Still **no `World`
import**.

```ts
export type WorkloadArchetypeId = 'web' | 'batch' | 'render' | 'training';

export interface WorkloadArchetypeDef {
  id: WorkloadArchetypeId;
  label: string;
  computeRequired: number;
  durationSeconds: number;
  payPerSecond: number;
  coolingBonusKw: number;   // per assigned machine, while running
  graceSeconds: number;
  minReputation: number;
}

export const WORKLOAD_ARCHETYPES: Record<WorkloadArchetypeId, WorkloadArchetypeDef> = {
  web:      { id: 'web',      label: 'Web Hosting', computeRequired: 10, durationSeconds: 45,
              payPerSecond: 0.90, coolingBonusKw: 0,   graceSeconds: 25, minReputation: 0  },
  batch:    { id: 'batch',    label: 'Batch Job',   computeRequired: 25, durationSeconds: 30,
              payPerSecond: 2.60, coolingBonusKw: 0,   graceSeconds: 20, minReputation: 20 },
  render:   { id: 'render',   label: 'Render Farm', computeRequired: 45, durationSeconds: 40,
              payPerSecond: 5.20, coolingBonusKw: 0.8, graceSeconds: 18, minReputation: 40 },
  training: { id: 'training', label: 'ML Training', computeRequired: 90, durationSeconds: 60,
              payPerSecond: 11.0, coolingBonusKw: 2.2, graceSeconds: 15, minReputation: 60 },
};

export const REPUTATION_ON_EXPIRY = -8;
export const REPUTATION_ON_COMPLETION = 3;
export const BROWNOUT_COOLDOWN_SECONDS = 1.0;
```

**`coolingBonusKw` is per assigned machine**, applied only while running. A `render` contract
spread over 5 `basic` machines adds 4.0 kW on top of their 1.5 kW baseline — cooling-heavy
work more than *triples* your burn. That's what makes cooling a distinct mechanic rather than
a second power bar: power scales with machines you own, cooling spikes with work you accept.

Four archetypes, not five. A fifth adds a table row to balance without adding a mechanic.

### Escalation

```ts
export function getArrivalInterval(elapsedSeconds: number, reputation: number): number {
  return (14 - Math.min(8, elapsedSeconds / 45)) * (1.6 - (reputation / 100) * 0.8);
}

export function getComputeScale(elapsedSeconds: number): number {
  return 1 + elapsedSeconds / 240;   // +100% every 4 minutes, linear
}
```

At spawn, **both** `computeRequired` and `payPerSecond` scale by `getComputeScale`. Keeping
$/compute-second flat means the difficulty is *capacity*, not margin — the player is never
squeezed by shrinking profitability, only by not having enough machines. Duration and grace
are **not** scaled; shrinking grace as contracts get bigger would compound cruelly.

Linear rather than exponential: it stays mentally readable, never overflows, and since the
player's capacity growth is roughly linear-with-compounding, the crossover where demand
outpaces a passive player lands naturally in the 10–20 minute range.

**Reputation** acts twice: as the arrival-rate multiplier above (higher reputation → contracts
arrive *faster*, i.e. more opportunity, which is why falling behind is partially
self-correcting) and as `minReputation` gating which archetypes can spawn. Starting at 50,
−8 per expiry, +3 per completion, clamped 0–100. Three whiffed contracts (−24) visibly costs
an income tier — legible and fully recoverable. Since completions vastly outnumber failures
when you're keeping up, a competent player pins at 100.

---

## Step 2 — Components

```ts
// Facility singleton — added alongside plan 1's wallet/reputation/capacities
export interface Utilization {          // derived cache, fully recomputed every frame
  powerDrawKw: number;
  coolingDrawKw: number;
  computeTotal: number;
  computeFree: number;
}

export interface DemandClock {
  elapsedSeconds: number;
  nextArrivalInSeconds: number;
  contractsServed: number;
  peakComputeServed: number;    // the score
}

// Machines
export interface Assignment { workloadId: EntityId; compute: number }

// Workloads — their own entities, with no Position and no Renderable
export type WorkloadState = 'pending' | 'running';

export interface Workload {
  archetypeId: WorkloadArchetypeId;
  computeRequired: number;
  durationSeconds: number;
  elapsedSeconds: number;
  payPerSecond: number;
  graceRemainingSeconds: number;
  state: WorkloadState;
}
```

Stores: `utilizations`, `demandClocks`, `assignments`, `workloads`. `spawnFacility` gains
`Utilization` (zeroed) and `DemandClock`; add `spawnWorkload(world, archetypeId, scale)`.

**`Utilization` is a derived cache, rewritten from scratch every frame by the `resource`
system.** It is never incrementally updated — no drift is possible. It exists so the HUD and
the assignment system read one component instead of each re-deriving a full scan.

### The assignment lives on the machine

`Assignment { workloadId, compute }` on the **machine**, not a machine list on the workload.

Every hot-path question is machine-indexed — "is this machine earning?", "what's its current
cooling draw including its workload's bonus?", "which slat is green?" — and each becomes a
single `getComponent`. The reverse direction needs a scan-and-sum every frame, plus the same
dangling-id risk that `world.destroyEntity` (which blindly clears every store) creates for any
stored id list. Aggregating upward — "how much compute does workload W have?" — is one pass
that the payout system already makes.

This means **a machine serves at most one workload**; a workload spans multiple machines. See
Risks for what that costs.

---

## Step 3 — System ordering

```
1. input             (plan 1)
2. install-progress  (plan 1)
3. path-follow       (unchanged)
4. movement          (unchanged)
5. resource          (NEW)
6. workload-spawn    (NEW)
7. workload-assign   (NEW)
8. workload-run      (NEW)
9. render            (modified)
10. hud              (plan 3)
```

**This ordering is load-bearing, and three of the constraints are subtle. Keep the comment on
the array in `main.ts` and state why.**

- **`resource` before every `workload-*` system.** It computes `Utilization` and flips each
  machine's `Powered.online`. If `workload-assign` ran first it would assign work to a machine
  that's about to go dark; if `workload-run` ran first it would pay for browned-out machines,
  and the capacity wall — the central constraint of the whole design — would be cosmetic.
- **`spawn` → `assign` → `run`.** A contract arriving this frame gets assigned in the same
  frame, so there's no one-frame "pending" flicker on a facility with ample capacity. And
  `run` — which destroys completed and expired workloads — never destroys something `assign`
  just wired up.
- **`resource` after `movement`** so a machine created by `install-progress` this frame is
  budgeted the same frame it appears.

---

## Step 4 — `resource` system (`src/ecs/systems/resource.ts`)

```ts
export function createResourceSystem(world: World, facility: EntityId): System
```

Each frame:

1. **Aggregate.** For every machine: add `powerKw` and `coolingKw` if online; add the
   archetype's `coolingBonusKw` if it also has an `Assignment` whose workload is running. Sum
   `compute` into `computeTotal` (online only) and into `computeFree` when unassigned.
2. **Brownout.** While `powerDrawKw > capacity` or `coolingDrawKw > capacity`, take machines
   offline **newest-first** (descending `EntityId`) until both fit. Set
   `offlineCooldown = BROWNOUT_COOLDOWN_SECONDS`, drop any `Assignment`, and subtract that
   machine's draw from the running totals.
3. **Recovery.** An offline machine with `offlineCooldown <= 0` may come back if its draw fits
   in the remaining headroom. Decrement cooldowns by `deltaSeconds`.
4. **Write `Utilization`** with the final numbers.

**Newest-first, not all-dark and not random.** All-dark is a death spiral that punishes one
overbuild by killing the whole facility. Random flickers and is unexplainable. Newest-first is
deterministic and self-explaining: *the machine you just plugged in is the one that tripped the
breaker*, and its LED goes red. The player's mental model and the code agree.

**Hysteresis is not optional.** With draw sitting exactly at capacity, a machine would flip
online/offline every few frames as `assign` grabs it and `resource` drops it — visible LED
strobing and thrashing assignments. The 1.0s minimum offline hold costs one field and one
comparison.

When a machine is taken offline while assigned, its workload loses that compute; if the
workload falls below `computeRequired`, revert it to `'pending'` (it keeps its remaining grace
and can be re-assigned). **Keep the brownout ordering as a pure exported function** over
`{ id, powerKw, coolingKw }[]` so it's testable and readable in isolation.

---

## Step 5 — `workload-spawn` system (`src/ecs/systems/workload-spawn.ts`)

Advance `DemandClock.elapsedSeconds`, decrement `nextArrivalInSeconds`. On reaching zero:

- Filter `WORKLOAD_ARCHETYPES` to those with `minReputation <= reputation.value`.
- **Weight toward the larger unlocked archetypes** so unlocking `render` actually changes what
  you see rather than being a rare event — a simple weight of `1 + index` over the eligible
  list is enough.
- `spawnWorkload(world, archetypeId, getComputeScale(elapsed))` — scaling
  `computeRequired` and `payPerSecond`, rounding compute to an integer.
- Reset `nextArrivalInSeconds = getArrivalInterval(elapsed, reputation.value)`.

Seed the first arrival at roughly 15s in `spawnFacility` so the player has time to install
their opening machines before anything is expected of them.

---

## Step 6 — `workload-assign` system (`src/ecs/systems/workload-assign.ts`)

For each `'pending'` workload, oldest first (by lowest `EntityId` — fairness, and it prevents
a big contract starving forever behind a stream of small ones):

- Gather online, unassigned machines as `{ id, compute }`.
- If their total `< computeRequired`, leave it pending.
- Otherwise select machines **smallest-first** until the requirement is met, attach an
  `Assignment` to each, and set the workload to `'running'`.

**Smallest-first minimizes stranded compute:** filling a 20-compute contract from two `basic`
(10 each) rather than one `dense` (45) leaves the `dense` available for something that needs
it. Greedy, not optimal — bin-packing optimally here would be complexity with no perceptible
gameplay benefit.

**Keep the selection as a pure exported function:**

```ts
export function selectMachinesForWorkload(
  candidates: { id: EntityId; compute: number }[],
  required: number,
): EntityId[] | null
```

No `World`, no components — the single most test-worthy piece of logic in the game, and
reviewable by reading.

---

## Step 7 — `workload-run` system (`src/ecs/systems/workload-run.ts`)

Build one `Map<workloadId, machineCount>` from `assignments` at the top (avoids a scan per
workload), then for each workload:

- **`'pending'`:** decrement `graceRemainingSeconds`. At `<= 0`: apply
  `REPUTATION_ON_EXPIRY`, clamp 0–100, and `destroyEntity`.
- **`'running'`:** add `payPerSecond * deltaSeconds` to the wallet; advance `elapsedSeconds`.
  At `>= durationSeconds`: apply `REPUTATION_ON_COMPLETION`, increment `contractsServed`,
  update `peakComputeServed`, **remove the `Assignment` from every machine that served it**,
  and `destroyEntity`.

**Clearing assignments before destroying the workload matters.** `world.destroyEntity` deletes
the workload from every store, but the machines' `Assignment` components hold its id — leaving
them would strand machines pointing at a dead entity, permanently unassignable. Same in the
expiry path for any partially-assigned workload.

---

## Step 8 — Clamp `deltaSeconds` (`src/core/index.ts`)

```ts
const rawDelta = lastTimestamp ? (timestamp - lastTimestamp) / 1000 : 0;
const deltaSeconds = Math.min(rawDelta, 0.1);
```

**This is a real bug, not a hypothetical.** `requestAnimationFrame` is throttled or paused in
a background tab, so alt-tabbing for 30 seconds produces a 30-second delta on return. Payout
is `rate * dt`, so the player would be paid a fortune; every grace timer would expire at once;
every running contract would complete instantly. One line. The 0.1s cap (10fps floor) means
the simulation slows rather than lies under load — the correct trade for a tycoon game.

Movement is already frame-rate-independent, so the clamp is safe for it too.

---

## Step 9 — Rendering and wiring

**`render.ts`:** derive `'online-busy'` for a machine that has an `Assignment`, versus
`'online-idle'` without. The slot-state plumbing from plan 1 makes this a one-line change to
the state derivation. Green LEDs now mean *earning money*, which is the whole point.

**`main.ts`:** insert the four systems in the order above, updating the ordering comment to
state the `resource`-before-`workload-*` rule and why.

Until plan 3's HUD, keep the temporary money readout and add a one-line power/cooling text —
otherwise a brownout is invisible except through LED colors, which makes this plan hard to
judge.

---

## Files

### New
| File | Contents |
|---|---|
| `src/ecs/systems/resource.ts` | aggregation, brownout ordering, hysteresis, unassign-on-offline |
| `src/ecs/systems/workload-spawn.ts` | demand clock, archetype selection, escalation |
| `src/ecs/systems/workload-assign.ts` | greedy smallest-first assignment |
| `src/ecs/systems/workload-run.ts` | grace/expiry, payout, completion, reputation |

### Modified
| File | Change |
|---|---|
| `src/ecs/game-data.ts` | archetypes, escalation + reputation functions and constants |
| `src/ecs/components.ts` | `Utilization`, `DemandClock`, `Assignment`, `Workload` + stores |
| `src/entities/index.ts` | `spawnWorkload`; `spawnFacility` gains `Utilization`/`DemandClock` |
| `src/ecs/systems/render.ts` | `'online-busy'` derivation; temporary power/cooling readout |
| `src/core/index.ts` | **one line** — clamp `deltaSeconds` |
| `src/main.ts` | four systems in order; expanded ordering comment |

---

## The opening, worked through

- **t=0:** $750. Buy 1 rack ($120) + 2 `basic` ($500) = $620, leaving $130. Two installs, ~3s
  each plus walking.
- **t≈17s:** first `web` contract, ~11 compute after scaling. 20 compute available → assigns
  immediately, earns ~$0.96/s → **~$43** over its 45 s.
- **Power binds first.** Each `basic` draws 0.4 kW against 3 kW capacity → **7 machines max**.
  Eight machines plus two racks is ~$2,240, reached around **6–8 minutes**. That's when the
  $400 power upgrade (+5 kW → 20 machines) becomes the obvious buy.
- **Cooling binds through workloads, not machine count.** The moment `render` unlocks at
  reputation 40 and you accept one on 3 machines: +2.4 kW on top of ~2.4 kW baseline against a
  3 kW chiller → **instant brownout**. This fires *before* the slow machine-count cooling wall
  would, teaching the mechanic through a spike rather than a creep. Deliberate.

Power wall ~7 min, cooling wall ~8–10 min, demand outpaces a passive player ~15 min.

**These are reasoned starting values, not tested balance.** Expect a tuning pass on
`getArrivalInterval`, upgrade costs, and pay rates after the first real playthrough — that's
scheduled in plan 3.

---

## Risks and trade-offs

- **One workload per machine wastes compute.** An 11-compute contract consumes two 10-compute
  machines, stranding 9. The alternative — fractional multi-tenancy — is where the complexity
  cliff is: `Assignment` becomes a list, machines need a remaining-compute field, brownout
  reclaim becomes partial, and a rack slat can no longer be simply green or amber. Whole-machine
  granularity keeps all of that trivial, and the waste is under ~10% at these numbers. Worth
  the trade, but it **is a real cost, not a feature** — if the stranding feels bad in play, the
  fix is smaller machine tiers, not fractional allocation.
- **Float accumulation in payouts is cosmetic, not arithmetic.** ~72,000 additions over 20
  minutes keeps absolute error near 1e-11 — never visible. The two real hazards are *display*
  (`$1240.0000000001` → always `Math.floor` for display) and *comparison* (`money >= cost` off
  by an epsilon → gate affordability on the floored value, per plan 1).
- **Dangling ids after `destroyEntity`.** `world.destroyEntity` clears every store but cannot
  know that a machine's `Assignment.workloadId` points at the entity being destroyed. Both
  destroy sites in `workload-run` must clear assignments first. This is the most likely bug in
  the plan; verification step 8 targets it directly.
- **Four new systems, all invisible.** Nothing here draws anything meaningful. The temporary
  readouts in step 9 are the minimum needed to judge whether it works; don't skip them on the
  grounds that plan 3 replaces them.
- **No tests, and no framework installed.** `selectMachinesForWorkload`, `getArrivalInterval`,
  and the brownout ordering are pure exported functions over plain data precisely so this
  hedge costs nothing. Adding `vitest` is a one-line devDependency and zero config.

## Verification

Manual only — no browser automation, per CLAUDE.md. `npm run lint` and `npm run build` clean.

1. First contract arrives ~15 s in. With capacity, it assigns immediately and money climbs at
   its pay rate.
2. Assigned machines show **green** LEDs; idle online machines amber; the count of green
   machines matches the contract's compute requirement (rounded up by machine size).
3. On completion, money stops climbing, the machines go back to amber, and reputation rises.
4. Let a contract expire with no capacity: it counts down its grace, vanishes, reputation
   drops, and the next arrival is **visibly slower**.
5. Build past 7 `basic` machines on 3 kW: power exceeds capacity, the **newest** machines go
   offline with red LEDs, and income visibly stops for their workloads.
6. Sit exactly at the capacity boundary for ~30 s: **no online/offline strobing** (hysteresis).
7. Buy a power upgrade during a brownout: machines come back and income resumes.
8. Complete and expire several contracts, then verify machines still take new assignments —
   no machine is permanently stuck (dangling `Assignment`).
9. Accept a `render` contract on a small facility → immediate **cooling** brownout, with power
   still under capacity. The two constraints are visibly independent.
10. Alt-tab for 30 seconds and return: **no money spike, no mass expiry** (delta clamp).
11. Play ~5 minutes: contracts grow and arrive faster; `batch` then `render` unlock as
    reputation climbs.
