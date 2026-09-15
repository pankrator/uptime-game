# Hardware failure and repair: giving the player character a job

> **Plan 10.** Depends on `.plans/facility-shop-inventory.md` (inventory, shop) and the
> existing `InstallTask` walk-and-work flow. Pairs strongly with
> `.plans/thermal-and-cooling.md` — heat is the most natural wear accelerant, and each plan
> makes the other matter more.
>
> Build **after** thermal if you are building both. Wear driven only by runtime is a flat
> tax; wear driven by heat is a consequence of the player's own layout decisions, which is a
> far better mechanic.

## Context

Every machine in the game is immortal and unchanging. Once `spawnMachine` puts it in a rack
([install-progress.ts:81](src/ecs/systems/install-progress.ts#L81)), it performs identically
forever. There is no reason to ever look at a rack again, and nothing that pulls the player
back onto the floor.

That is a problem specifically because of what was already built: a walking avatar, A*
pathfinding, proximity-gated panels, and a timed install task requiring physical presence
([install-progress.ts:40-50](src/ecs/systems/install-progress.ts#L40-L50)). All of that
machinery serves exactly one action — installing a machine, once, per machine. **The walk is
currently pure delay.** With failures, the walk becomes triage: which of three dead servers
do you fix first, with deadlines ticking.

This plan also closes a real gap: there is currently no way to get rid of a machine. A player
who fills a rack with `budget` boxes early is stuck with them, and
`.plans/power-billing.md` D4 flags the resulting dead-end (negative money, no way to shed
draw). Step 6 fixes that.

---

## Design decisions

### D1. Wear is a per-machine scalar that only goes up

```ts
export interface Condition {
  wear: number;        // 0 = new, 1 = worn out
  failed: boolean;
}
```

On machine entities. Like `Temperature`, this is **integrated state, not a derived cache** —
same exception to the codebase's recompute-every-tick discipline, same reason (history), and
it needs the same loud comment. Owned solely by `wear.ts`.

Wear accrues only while the machine is **online**. An offline machine — browned out, thermally
tripped, or awaiting repair — does not wear. That keeps the mechanic legible ("running things
wear out") and avoids punishing a player twice for a brownout.

### D2. Failure is a probabilistic roll gated by wear, not a fixed lifespan

```ts
failureChancePerSecond = BASE_FAILURE_RATE * wearMultiplier(wear)
```

A deterministic "fails at exactly 600s" makes optimal play a stopwatch. A wear-scaled roll
means a new machine almost never fails and a neglected one probably will — the player manages
*risk*, which is the actual management fantasy.

Keep `BASE_FAILURE_RATE` low. At `wear = 0` failures should be genuinely rare; the curve
should be steep only in the top third of the wear range, so replacing at ~70% wear is
rewarded and the player has a clear, learnable policy.

**Roll per second, not per tick.** Accumulate elapsed time per machine and roll on whole
seconds. A per-tick roll makes the effective failure rate depend on `UPDATE_HZ` and — after
`.plans/time-controls.md` — on the current time scale, which would make fast-forward
*literally more dangerous*. That is a subtle, nasty bug; guard against it explicitly by
scaling the roll by `deltaSeconds`.

### D3. Heat accelerates wear (if thermal shipped)

```ts
wear += WEAR_PER_SECOND * heatMultiplier(rackTemperatureC) * dt
```

A rack in the throttle band wears meaningfully faster. This is the join between the two plans
and it is what makes bad layout *compound*: hot racks throttle (less income) and wear faster
(more repairs, earlier replacement).

If thermal has not shipped, `heatMultiplier` returns 1 and the plan still works — just flatter.

### D4. A failed machine goes offline and drops its workloads

Reuse the brownout path exactly, as thermal does: `Powered.online = false` and `unplaceAllOn`
([resource.ts:51-55](src/ecs/systems/resource.ts#L51-L55)) returns workloads to the tray with
deadlines intact — a visible, recoverable setback rather than silent loss.

The difference from a brownout is **it does not recover on its own.** No `offlineCooldown`
countdown brings it back. It stays dead until the player walks over and repairs it. That is
the entire point: it creates a task only the player's physical presence can clear.

Like `ThermalTrip`, failure is a **veto** that `resource.ts` reads (D7 of the thermal plan) —
it never sets `Powered.online = true`. Single writer, no fighting systems.

### D5. Repair generalizes `InstallTask` rather than duplicating it

`InstallTask` already encodes exactly the needed shape: a target rack, a walk, an arrival
check, a countdown, and a completion effect
([install-progress.ts:32-85](src/ecs/systems/install-progress.ts#L32-L85)).

Generalize it:

```ts
export type MaintenanceKind =
  | { kind: 'install'; tierId: MachineTierId; slotIndex: number }
  | { kind: 'repair'; machineId: EntityId }
  | { kind: 'decommission'; machineId: EntityId };

export interface MaintenanceTask {
  rackId: EntityId;
  job: MaintenanceKind;
  secondsRemaining: number;
  totalSeconds: number;
  arrived: boolean;
}
```

Rename `InstallTask` → `MaintenanceTask`, keep the arrival logic untouched, and branch only at
completion. `install-progress.ts` becomes `maintenance.ts`.

**One task at a time**, still attached to the player, exactly as today. A queue would be more
convenient and strictly worse: the scarcity of the player's attention *is* the mechanic. If it
proves too punishing, the answer is hired staff (`.plans/ideas-backlog.md`), not a queue.

Worth noting the existing refund path: on a failed install, `install-progress.ts` refunds
`MACHINE_TIERS[task.tierId].cost` to the wallet
([install-progress.ts:57-61](src/ecs/systems/install-progress.ts#L57-L61)). That is now
**stale** — since `.plans/facility-shop-inventory.md` D5, placement consumes *inventory*, not
money. Fix it while restructuring: return the item to inventory, not cash. Otherwise a cancel
loop mints money.

### D6. Repair restores condition partially, and repairs get worse

```ts
wear = Math.max(0, wear - REPAIR_WEAR_RECOVERY)   // e.g. 0.35, not full reset
```

A repair buys time, never a new machine. Without this, one cheap machine plus infinite repairs
dominates, and there is no reason to ever buy replacement hardware.

Repair cost scales with wear — fixing a nearly-dead machine costs nearly what a new one does —
so at some point replacing is obviously correct. That crossover is the decision the mechanic
exists to create.

### D7. Failures must be visible from across the floor

The player is usually somewhere else when a machine dies, possibly with the camera panned
away. If they only find out by opening a rack panel, failures are invisible and the mechanic
becomes mysterious income loss.

Required, not optional:
1. **Rack rendering** — a failed rack is unmistakable at a glance (red LED, warning glyph).
2. **HUD alert** — a persistent line listing failed machines.
3. **Off-screen marker** — an edge arrow pointing toward the failure, reusing the pattern from
   `drawShopHint` ([render.ts:329](src/ecs/systems/render.ts#L329)).

### D8. Failure rate is the least-safe constant in the game

This mechanic sits on a knife edge: slightly too frequent and the game is janitorial busywork;
too rare and it never registers. Assume the first value is wrong.

Target for tuning: at a mature facility (~15 machines), roughly **one failure every 2-3
minutes** of simulated time, heavily concentrated in old and hot hardware. Rare enough to be an
event, frequent enough to shape behavior.

---

## Step 1 — constants and component

`game-data.ts`:

```ts
export const WEAR_PER_SECOND = 0.0008;        // ~20 min of runtime to fully wear
export const BASE_FAILURE_RATE = 0.0004;      // per second at wear = 0
export const WEAR_FAILURE_EXPONENT = 3;       // steep only near the top
export const REPAIR_WEAR_RECOVERY = 0.35;
export const REPAIR_BASE_SECONDS = 4;
export const REPAIR_COST_FRACTION = 0.4;      // of tier cost, scaled by wear
export const DECOMMISSION_REFUND_FRACTION = 0.3;
export const HEAT_WEAR_MULTIPLIER_MAX = 3;    // at TRIP_C
```

`components.ts`: `Condition` (per D1, with the not-a-cache comment), plus a `Failed` marker for
the `resource.ts` veto.

## Step 2 — `src/ecs/wear.ts` (pure math)

```ts
export function wearMultiplier(wear: number): number
export function heatWearMultiplier(celsius: number): number
export function failureChancePerSecond(wear: number): number
export function repairCost(tierCost: number, wear: number): number
export function repairSeconds(wear: number): number
```

Pure, no world, testable alone — same shape as `traits.ts` and `thermal.ts`.

## Step 3 — `src/ecs/systems/wear.ts`

Per tick, for each online machine:
1. Accumulate wear (D1, D3).
2. Roll for failure, scaled by `deltaSeconds` (D2's warning).
3. On failure: `failed = true`, add `Failed`, `Powered.online = false`, `unplaceAllOn`.

Order it **after `thermal.ts`** (needs current temperature) and **after `resource.ts`** (needs
`Powered.online`). Add the rationale to `main.ts`'s ordering comment.

## Step 4 — `resource.ts` veto

A machine with `Failed` is never an online candidate — one added condition alongside the
`ThermalTrip` check, same shape.

## Step 5 — generalize the task (D5)

1. Rename `InstallTask` → `MaintenanceTask` with the `job` union.
2. Rename `install-progress.ts` → `maintenance.ts`; branch at completion:
   - `install` — as today (`spawnMachine`).
   - `repair` — reduce wear, clear `Failed`/`failed`, debit repair cost.
   - `decommission` — destroy the machine, refund, free the slot.
3. **Fix the stale refund** to return inventory rather than money (D5).
4. Update `render.ts`'s `drawInstallIndicator` to label the job kind — "Installing…",
   "Repairing…", "Removing…" — so the progress bar says what it is doing.

## Step 6 — rack panel actions

The rack panel is where the player already inspects servers, so the actions belong there:

- A **wear bar** per server row, reusing the trait-bar drawing already present
  ([render.ts:669-671](src/ecs/systems/render.ts#L669-L671)). Green→amber→red.
- **Repair** button on failed or worn servers, showing the cost. Starts a `MaintenanceTask`.
- **Decommission** button, showing the refund.

Both need hit-test rects in `layout.ts` (`getServerRepairButtonRect`,
`getServerDecommissionButtonRect`) following the one-function-per-region rule, and branches in
the rack panel's click chain.

⚠️ The rack panel already has a dense click chain (drag start, drag end, tray cards, scroll,
close). Add these as explicit early branches, before drag handling, or a click on "Repair" will
be read as the start of a drag on that row.

**Decommission needs confirmation** — it destroys a purchased item for a partial refund, and a
misclick next to a drag target is easy. A second click to confirm on the same button is enough;
no modal.

## Step 7 — visibility (D7)

Rack LEDs for failure, the HUD alert list, and the off-screen edge marker. Reuse
`drawShopHint`'s approach for the marker.

## Step 8 — tuning

With fast-forward:
1. **Nothing fails in the first few minutes.** Early failures, before the player has cash or
   understanding, read as the game being broken.
2. **A mature facility sees ~1 failure per 2-3 simulated minutes** (D8).
3. **Hot racks demonstrably fail more** (only meaningful with thermal).
4. **The repair/replace crossover is findable** — around 70-80% wear, replacing should be
   obviously better, and the panel's numbers should make that legible without arithmetic.
5. **Failures during a busy moment are recoverable**, not a spiral. If three failures plus two
   deadlines is unwinnable, lower the rate.

---

## Files

| File | Change |
| --- | --- |
| `src/ecs/wear.ts` | **new** — pure wear/failure/cost math |
| `src/ecs/systems/wear.ts` | **new** — accrue wear, roll failures |
| `src/ecs/systems/maintenance.ts` | **renamed** from `install-progress.ts`; job branch |
| `src/ecs/game-data.ts` | wear/failure/repair constants |
| `src/ecs/components.ts` | `Condition`, `Failed`; `InstallTask` → `MaintenanceTask` |
| `src/ecs/systems/resource.ts` | `Failed` vetoes online candidacy |
| `src/ecs/systems/rack-panel.ts` | repair/decommission branches |
| `src/ui/layout.ts` | repair/decommission button rects |
| `src/ecs/systems/render.ts` | wear bars, failure LEDs, job labels, edge marker |
| `src/ecs/systems/hud.ts` | failure alert list |
| `src/entities/index.ts` | machines spawn with `Condition` |
| `src/main.ts` | register `wear`; rename install system; ordering comment |

## Trade-offs worth flagging

- **This can become a treadmill.** The single biggest risk in the plan. If playtesting feels
  like chores, cut the failure *rate* — do not cut the feature and do not add a repair queue.
  The scarcity of player attention is the mechanic (D5).
- **A second component breaks the derived-cache discipline.** `Condition` joins `Temperature`.
  Two exceptions is a pattern; consider documenting "integrated state" as a named, legitimate
  category in `CLAUDE.md` rather than letting each plan re-justify it.
- **Three systems can now take a machine offline** (brownout, thermal, failure). The veto
  discipline keeps `resource.ts` the single writer of `Powered.online`, but this is now
  genuinely intricate. A comment in `resource.ts` listing all three veto sources is worth more
  than it costs.
- **Randomness invites frustration.** A failure the instant before a deadline will feel unfair
  because it *is*. Consider suppressing failure rolls on a machine hosting a workload within a
  few seconds of completion — a small, invisible mercy that costs nothing and removes the
  worst-feeling outcome.

## Verification

Per CLAUDE.md: no browser automation, no starting the project from here — manual validation.

1. `npx tsc --noEmit` clean after each step.
2. **Wear accrues only while online:** browned-out and failed machines hold steady.
3. **Failure drops workloads** to the tray with deadlines intact, and the machine stays
   offline indefinitely (no self-recovery).
4. **Repair flow:** button → player walks → progress bar reads "Repairing…" → machine returns
   online with reduced wear and the cost debited.
5. **Decommission:** confirm-click destroys the machine, refunds, frees the slot, and a new
   machine can be installed there.
6. **The stale-refund fix:** cancelling an install returns the item to *inventory*, not money
   to the wallet (D5) — verify money is unchanged.
7. **Visibility:** a failure while the camera is panned away is noticed within seconds from
   the HUD and the edge marker alone.
8. **Speed-independence:** failures per *simulated* minute are the same at 1x and 4x (D2's
   trap).
