# Simulation playtest: logic bugs and design issues

> **Not a feature plan — a findings report.** Written from a headless simulation, not from a
> browser: a harness built the same system pipeline `main.ts` builds, and a scripted player
> drove it through the real gameplay entry points (`handleBuildModePlacement`, `startInstall`,
> `startRepair`, `startDecommission`, `buy`, `acceptOffer`, `checkPlacement`/`placeWorkload`).
> No dev server, no browser automation — consistent with CLAUDE.md's manual-validation rule and
> `testing-strategy.md`'s headless layer.
>
> That harness now lives in `src/sim/` (see [docs/simulation.md](../docs/simulation.md)), so
> every measurement below can be re-run: `VERBOSE_SIM=1 npx vitest run src/sim
> --disable-console-intercept`. Its committed scenarios are shorter than the runs quoted here
> and use the same strategies under their shipped names — `none`, `biggest-affordable`,
> `unlocked-mix`, `blade-only`.
>
> Entries are numbered `S1`–`S13` to avoid colliding with `playtest-findings.md`'s `B*`/`F*`
> and `design-review.md`'s `F*`. Severity order within each section. Every entry has a
> reproduction or a measurement.

## How this was measured

`Math.random` seeded with a deterministic PRNG (seeds 12345 / 999 / 4242), fixed `dt = 1/30`
matching `UPDATE_HZ`, 20–30 simulated minutes per run. An invariant checker ran every tick
(placement/state consistency, non-negative free capacity, temperature/throttle range,
reputation range, offer cap and slot uniqueness, grid-cell collisions, `Failed`/`ThermalTrip`
vs `Powered.online`, NaN sweeps).

Player strategies simulated:

| Strategy | What it does |
| --- | --- |
| `none` | Buys nothing. Runs the two starting Budget Boxes, accepts only offers that fit. |
| `biggest-affordable` | Buys the highest-CPU tier it can afford; accepts only offers that fit. |
| `unlocked-mix` | Buys tiers matched to whatever reputation has unlocked. |
| `blade-only` | Saves for Blade Chassis only. |
| `acceptUnservable` | Accepts every offer regardless of fit. |
| `blade-only` + `manageThermals` | Buys/places CRACs, caps servers at 2 per rack. |

The existing suite is green throughout (176/176 on `ae57114`) — none of this is caught today.

---

## 1. Logic bugs

### S1 — Decommissioning a loaded server strands its workloads forever (data corruption)

`maintenance.ts:244` calls `world.destroyEntity(job.machineId)` without unplacing anything
first. `PlacedOn` lives on the **workload**, not the machine, so `destroyEntity`'s store sweep
never touches it. The workload is left pointing at an entity that no longer exists.

Measured, with one Web Hosting contract running on the decommissioned box:

```
workload state: running   placedOn: {"serverId":3}   workRemaining: 58.0
after 10 more simulated seconds: workRemaining 58.0, earned $0.00
```

Consequences, all of them silent:

- `workload-run.ts` looks up `powereds[placement.serverId]` → `undefined` → no pay, no
  progress. The contract is frozen.
- `deadlineRemainingSeconds` keeps ticking, so it *will* miss, for the full `penaltyOnMiss`
  plus `REPUTATION_ON_MISSED_DEADLINE`.
- It still reads `state: 'running'`, so `trayWorkloadIds` (`rack-panel.ts`) never lists it and
  the player cannot drag it anywhere. `jobPanelCounts` counts it as active.
- Nothing warns before the click. The decommission confirm window (`DecommissionConfirm`) is a
  generic double-click, not "this box has 3 contracts on it".

**Fix:** call `unplaceAllOn(world, job.machineId)` (already exported from `resource.ts` and
already reused by `thermal.ts`/`wear.ts` for exactly this) before `destroyEntity`, in both the
decommission branch and `startDecommission`'s precondition check. Worth also refusing — or at
least warning on — a decommission of a loaded server.

### S2 — The thermal model has no negative feedback, so a hot rack oscillates forever

`Temperature.throttleFactor` cuts pay and work progress in `workload-run.ts`, but it never
touches heat. `drawFor` (`resource.ts`) derives `coolingKw` from the tier constant plus each
placed workload's `coolingBonusKw`, and `capacity.ts` copies that straight into
`RackLoad.heatKw`. A rack at 64 °C throttled to `x0.03` still emits 100% of its heat.

So the throttle band (45–65 °C) is not a governor. A rack whose target temperature exceeds
`TRIP_C` has **no steady state**: it climbs through the band, trips, `unplaceAllOn` dumps every
workload, heat instantly drops to 0 kW, it cools to `TRIP_RECOVER_C`, machines come back,
workloads are restored, and it climbs again.

Measured — 3 Blade Chassis running ML Training in one rack, 5 simulated minutes:

```
135 thermal trips
tripped 43% of ticks, throttled 48%
work was dumped off a server 44% of ticks
temperature swung 21C .. 65C — never settles
earned $2344 vs $9900 unthrottled (24%)
```

The cycle has a ~7 s period:

```
t=121.0s 40.6C x1.00 placed=3 heat=10.8kW
t=124.5s 64.3C x0.03 placed=3 heat=10.8kW
t=125.0s 61.1C TRIP  placed=0 heat=0.0kW
t=127.5s 40.3C TRIP  placed=0 heat=0.0kW
t=128.0s 44.1C x1.00 placed=3 heat=10.8kW
```

This is what produced `machine:thermal-tripped: 360` in a 30-minute unmanaged run.

**Fix:** multiply the workload-driven part of `drawFor`'s heat by the rack's `throttleFactor`
so throttling actually sheds load. The band then becomes a stable attractor and a trip means
"you overbuilt", not "you are now in a loop".

### S3 — The missed-deadline toast prints an unrounded float

`workload-run.ts:117` interpolates `workload.penaltyOnMiss` raw. Every other readout of the
same field uses `.toFixed(0)` (`hud.ts:385`, `hud.ts:433`, `hud.ts:620`, `render.ts:1210`), and
`spawnOffer` scales the penalty by a non-integer `valueScale`:

```
penaltyOnMiss = 109.33333333333334
toast = "Missed deadline: Batch Job — -$109.33333333333334, -8★"
```

**Fix:** `.toFixed(0)`, matching the other four sites.

### S4 — The queue-a-drop-while-walking path is dead code

`docs/ecs-systems/rack-panel.md` documents it, `PendingDrop` exists as a component, it is in
`save/registry.ts`, `closeRackPanel` clears it, and `createRackPanelSystem` has an
arrival-time commit loop for it. None of it can run: `tryStartDrag` returns early unless
`panel.mode === 'dispatching' && panel.arrived`, so a `DragState` can only exist *after*
arrival, so `resolveDrop`'s `else` branch is unreachable.

```
openOrPromoteRackPanel(...)  -> arrived = false
tryStartDrag(tray card)      -> false
DragState                    -> undefined
```

**Fix:** either delete `PendingDrop` and its commit loop (and the doc section), or let
`tryStartDrag` run pre-arrival so the documented behaviour actually happens. The second is the
better game — dropping work onto a rack you're walking to is the whole point of the walk — but
either way the current state is a component, a save-format entry, a system branch and a doc
section that describe behaviour the game does not have.

### S5 — `ServerCapacity.free` is a once-per-tick cache, but two call sites place more than once per tick

`checkPlacement` reads `ServerCapacity.free`; `placeWorkload` deliberately does not decrement
it (`dispatch.ts`: "Capacity.ts recomputes ServerCapacity.free next tick"). So any code that
does `checkPlacement`/`placeWorkload` twice in one tick against the same server validates the
second placement against pre-first-placement capacity:

```
free after two same-tick placements: {"cpu":-8,"ramGb":-32,"storageGb":-1000}
```

Two call sites have exactly that shape:

- `resource.ts`'s `restoreRecentlyUnplaced` — loops every `RecentlyUnplaced` tag for the server.
- `rack-panel.ts`'s arrival commit loop — loops every `PendingDrop`, with a comment claiming it
  skips drops that "no longer fit", which it cannot actually detect.

Both are *accidentally* safe today: the restore loop only ever re-places a set that already fit
that same server, and the commit loop is unreachable (S4). The UI is safe too — one mouseup per
tick. But the invariant is held by coincidence, not by construction, and the first feature that
places two workloads in a frame (batch dispatch, a "fill this rack" button, auto-placement)
breaks it silently, because nothing validates `free >= 0`.

**Fix:** make `placeWorkload` decrement and `unplaceWorkload` restore `ServerCapacity.free`
(keeping `capacity.ts`'s full recompute as the authority each tick), or have the two loops
track a running local budget. A cheap assertion in `capacity.ts` that `free[k] >= 0` would turn
the next occurrence into a loud failure instead of a phantom over-subscription.

### S6 — The simulation runs at 10% speed in a background tab

`core/index.ts` uses `setInterval` specifically so the sim keeps advancing while the tab is
hidden (the comment says so). But browsers clamp background `setInterval` to ≥1000 ms, and the
loop clamps `deltaSeconds` to `MAX_DELTA_SECONDS = 0.1`. So a hidden tab ticks once per second
and advances 0.1 s of game time per tick — **one tenth of real time**, with no catch-up. The
stated reason for choosing `setInterval` over rAF is defeated.

**Fix:** accumulate the raw delta and run up to N fixed sub-steps per timer fire, clamping the
number of sub-steps rather than the delta itself.

### S7 — Wall-clock timers are mixed into a delta-time simulation

`performance.now()` drives `RecentlyUnplaced.expiresAtMs` (`resource.ts`), `FloatingText`/
`Toast` expiry (`effects.ts`), `RejectedDrop` and `DecommissionConfirm` (`rack-panel.ts`), and
`AcceptConfirm` (`job-panels.ts`). Everything else advances on `deltaSeconds`. The two clocks
already disagree under S6 (a 10 s brownout grace becomes ~1 s of game time in a background
tab), and plan 7 (`time-controls.md`) — the plan the index says to **build first** — makes them
disagree by the fast-forward factor on every frame.

**Fix:** a facility-owned simulation clock (`DemandClock.elapsedSeconds` already exists) as the
time base for anything gameplay-affecting. Presentation-only fades can keep wall clock.

---

## 2. Balance and design issues

### S8 — Doing nothing beats playing

Six 30-minute runs with an active player (`biggest-affordable` and `unlocked-mix`, three seeds each). In every
single one, **peak wallet balance was the starting balance**:

| Strategy | seed | final $ | min $ | max $ | contracts served |
| --- | --- | --- | --- | --- | --- |
| biggest-affordable | 12345 | -9 | -23 | **750** | 32 |
| biggest-affordable | 999 | 16 | 0 | **750** | 38 |
| biggest-affordable | 4242 | 77 | 0 | **750** | 24 |
| unlocked-mix | 12345 | 77 | -13 | **750** | 35 |
| unlocked-mix | 999 | 70 | 0 | **750** | 37 |
| unlocked-mix | 4242 | 52 | 0 | **750** | 37 |

The `none` buyer — which buys *nothing*, runs the two starting Budget Boxes, and accepts only what
fits — finished the same 30 minutes at **$2,467**, monotonically increasing, never once dipping.

Every purchase in the mid-game has negative ROI, because (S9) income is capped by contract
supply, not by capacity, while power draw, repair costs and miss penalties all scale with the
hardware you own.

### S9 — Reputation is a trap stat: success makes the game unplayable

`pickArchetype` weights eligible archetypes `1..n`, so unlocking an archetype *displaces* the
ones below it. Combined with `getArrivalInterval`, higher reputation means more offers but far
fewer servable ones:

```
rep  eligible                    mix (%)                              offers/min  web offers/min
  0  web                         web:100                                    6.2            6.2
 20  web,batch                   web:33 batch:67                            6.9            2.3
 40  web,batch,render            web:17 batch:33 render:50                  7.8            1.3
100  web,batch,render,training   web:10 batch:20 render:30 training:40     12.5            1.3
```

`REPUTATION_ON_COMPLETION` is +3 and the cap is 100, so ~30 completed contracts pins it. At
roughly 6 contracts/minute in the opening, that is **five minutes**. After that the player is
permanently in the bottom row.

Measured share of offers the player could never accept (no online server fit), 30 min,
`biggest-affordable`, seed 12345:

```
offered:         web 31, batch 54, render 78, training 100   (263 total)
accepted:        web 31, batch 1                             (32 total)
never servable:  batch 53, render 78, training 100           (88% of all offers)
```

The perverse proof: the `acceptUnservable` player, who missed 62 deadlines and drove
reputation down to 39, ran at **$14.83/s revenue** — higher than any careful player in any run
(0.00–3.06/s at reputation 100). Deliberately failing produces a better offer mix than
succeeding.

There is also no way down other than failing: `clampReputation` floors at 0, completions only
add, and the only reductions are `REPUTATION_ON_DECLINE` (-1), `ABANDON_REPUTATION_COST` (-4)
and a miss (-8).

**Fix options:** keep low-tier archetypes at a floor weight instead of letting them be
displaced; or gate archetype *availability* on installed capacity rather than reputation; or
raise `MAX_OFFERS` with reputation so the absolute supply of servable work grows too.

### S10 — `getValueScale` reads facility-wide CPU, but the fit check is per-server

`capacityScale = max(1, facilityCpu / 30)` sums `Utilization.traitsTotal.cpu` across **every
online machine**, and that scale is then applied to a single offer's `demands` — which must fit
on **one** server. Scaling horizontally therefore makes offers strictly harder to serve:

- 9 Servers (`basic`, 8 CPU each) = 72 facility CPU → `valueScale` 2.4 → a Batch Job asks for
  ~19 CPU. No `basic` can hold it. The player made their own contracts unservable by buying.
- 3 Blade Chassis = 96 facility CPU → same scale, but each box has 32 CPU and holds it fine.

Past ~10 minutes, `MAX_DEMAND_SCALE` means every scaled archetype needs a Blade Chassis:
`batch` at 3× is 24c/48g/600G, `render` at 2.5× is 15c/50g/2000G, `training` at 1.33× is
16c/128g/533G — all of them `dense`-only. The catalog's other four tiers become dead weight
for everything except unscaled `web`, which is the deliberate opposite of what
`MACHINE_TIERS`' own comment says the lopsided catalog is for.

**Fix:** base `capacityScale` on the *largest single server's* CPU (or the Nth-largest), which
is the quantity the fit check actually tests.

### S11 — There is a cliff, and crossing it ends the game in the other direction

The `blade-only` + `manageThermals` player (Blade Chassis only, ≤2 per rack, CRACs next to hot racks) hits the
same wall as everyone else for 12 minutes — and then:

```
min | money  rep served  tiers            facCPU  rev/s
 11 |    352  100     26  budgetx2 densex7    232  267.26
 12 |    365  100     39  budgetx2 densex18   584  141.00
 13 |   5223  100     50  budgetx2 densex22   712  202.93
 20 |  90344  100    136  budgetx2 densex22   712  264.03
 30 | 222979  100    260  budgetx2 densex22   712  314.07
```

$365 → $222,979 in 18 minutes, with `contract:missed: 7` against the unmanaged run's 69–92.
Money then has nowhere to go: `ROOM_TIERS` caps at $4,500 and the catalog tops out at $900, so
the score stops meaning anything — the second half of `playtest-findings.md`'s "money sink"
note, now measured.

The entire difference between the two outcomes is **one unstated rule: spread servers across
racks and buy CRACs**. Nothing in the tutorial, the shop, or the HUD says it.

### S12 — The shop sells a "Cooling" upgrade that does not cool anything

`thermal.ts` reads `BASELINE_COOLING_KW` and placed `CoolingUnit`s. It never reads
`coolingCapacities`. `+5kW Cooling` ($350, category **Cooling**) only widens the brownout
budget in `resource.ts`. A/B on an identical overheating rack:

```
0 upgrades : cooling budget 500kW, rack settles at 42.80C
10 upgrades: cooling budget 550kW, rack settles at 42.80C
money spent on cooling that changed nothing thermal: $3,500
```

The HUD compounds it: `❄ COOLING 2.1 / 3.0 kW` (the budget) sits a few pixels from
`🌡 2 throttled ⛔ 1 overheated` (the thermal model), two unrelated systems sharing a word. The
one thing that *does* help — the CRAC Unit — is in the same shop category, so the trap is
adjacent to the fix.

**Fix:** rename the facility resource (Power Draw / **Capacity**) or fold the two models
together. At minimum, don't file them under the same category name.

### S13 — Racks have 6 slots and a thermal budget for 1–2

A rack throttles past 4.77 kW of heat and trips past 8.10 kW (`(THROTTLE_C - AMBIENT_C) /
HEAT_TO_DEGREES + BASELINE_COOLING_KW`). Settled temperature by occupancy, no CRACs:

```
tier    + workload  | 1      2          3          4      5          6
basic   + web       | 18C    20C        22C        24C    25C        27C
basic   + render    | 23C    30C        36C        43C    49C/x0.78  56C/x0.45
dense   + web       | 25C    33C        42C        50C/x0.75  58C/x0.33  65C/x0.02
dense   + render    | 30C    43C        56C/x0.45  TRIP   (limit cycle — see S2)
dense   + training  | 38C    60C/x0.27  TRIP       TRIP   (limit cycle)
```

A Blade Chassis running ML Training fills a rack's entire thermal budget on its own. Four of
six slots are unusable for the tiers and archetypes the late game forces you into. CRACs only
partially close it — a full ring of 8 around one rack is $3,600 and 6.4 kW of extra power draw:

```
6 busy dense boxes: 0 CRACs -> x0.17 throttle; 2 -> x0.59; 4 -> x0.87; 8 -> x1.00
```

**Fix:** either raise the per-rack thermal headroom so `RACK_SLOT_CAPACITY` means something, or
lower `RACK_SLOT_CAPACITY` to what the model supports and let racks be cheap and numerous.

---

## 3. Smaller design notes

- **Placed racks and CRACs can never be removed.** The only `destroyEntity` for a world object
  is the decommission branch in `maintenance.ts`. A CRAC dropped on the wrong cell is a
  permanent $0.16/s drain and a permanently blocked tile, placed with one click and no undo.
- **A broke facility with failed hardware has no repair path.** `startRepair` requires
  `Math.floor(wallet.money) >= cost`, and only a completed repair clears `Failed`. With no
  online machine there is no income, and CRAC power is billed unconditionally, so the balance
  only falls. The one escape — decommissioning for a 30% refund — has no cash gate but is not
  signposted anywhere. Verified: at -$50 with a 90%-worn failed box, `startRepair` no-ops and
  the machine never returns.
- **`selectMachinesToBrownOut` sorts newest-first**, so the Blade Chassis you just spent $900
  on is the first thing to go dark. Deliberate and documented, but from the player's seat the
  upgrade appears broken on arrival.
- **Building on your own tile.** `isGridCellOccupied` (`build.ts`) only checks
  `gridPositions`; the player has `positions`. You can place a rack on the cell you are
  standing in.
- **`simplifyPathToPixels` undoes `buildOccupiedSet`'s optimization.** `findPath` builds the
  occupancy set once "rather than each `isWalkable` call doing its own `world.query` scan", then
  `hasLineOfSight` rebuilds it on every line-of-sight probe — O(path² × entities) per click.
- **`resource.ts:228` guards on `powerAvailableKw > 0` but divides by `powerCapacity.kw`.**
  Harmless today; the guard and the divisor should be the same quantity.
- **Doc drift.** `docs/ecs-systems/install-progress.md` documents a system that no longer
  exists (it became `maintenance.ts`), and `CLAUDE.md`'s system index still links it.
  `maintenance.ts` and `wear.ts` have no doc. `.plans/README.md` says "two tests are currently
  failing on `main`" under **Code health**; the suite is 176/176 green on `ae57114`.

---

## 3b. Corrections made while fixing these

Two entries above were wrong in ways that only showed up once someone tried to implement them.
Left in place rather than silently rewritten, since the reasoning is the useful part.

- **S10's proposed fix was wrong.** "Base `capacityScale` on the largest single server's CPU"
  pins `getValueScale` at 1.07 forever — the biggest tier is 32 CPU against a divisor of 30 —
  which would have re-broken the B3 deadlock `compute-scale-fix.md` fixed, and which
  `game-data.test.ts`'s own B3 regression test catches. The diagnosis (demand size scaled off a
  quantity no single server has to match) was right; the remedy was not. What shipped clamps the
  DEMAND scale to what the player's best online server can hold and leaves the VALUE scale alone.
- **S12 claimed the chiller upgrade sat in the CRAC's shop category.** It did not — it was
  already under Utilities while the CRAC was under Cooling. The shared *name* was the whole trap;
  the category adjacency was not real.
- **S5's proposed fix would have broken a stated rule.** Having `placeWorkload` decrement
  `ServerCapacity.free` gives that component two writers, which CLAUDE.md forbids and which would
  let the deltas and capacity.ts's recompute drift. What shipped makes `checkPlacement` derive
  free capacity from the placements themselves, so the cache keeps one writer.
- **S7's scope was smaller than stated.** Only `RecentlyUnplaced` was on the wrong clock. The
  confirm windows and toast/flash lifetimes measure human reaction time and presentation, where
  wall clock is correct; none of them is persisted, so none carried the save/load hazard.
- **S4 was sized as small; it is not.** Implementing the queue-a-drop path means drawing and
  hit-testing a panel that is currently not rendered at all before arrival. It was removed and
  written up in `ideas-backlog.md` instead.

---

## 4. Suggested order

| # | Finding | Why first | Cost |
| --- | --- | --- | --- |
| 1 | S1 decommission strands workloads | Silent data corruption with a money/reputation cost | trivial |
| 2 | S3 unrounded toast | One `.toFixed(0)` | trivial |
| 3 | S9 reputation offer mix | The single reason the mid-game has no legal moves | small |
| 4 | S2 throttle sheds no heat | Turns thermal from a loop into a mechanic | small |
| 5 | S10 per-server capacity scale | Makes horizontal scaling stop being self-defeating | small |
| 6 | S12 cooling naming | A shop item that takes money and does nothing | small |
| 7 | S6/S7 time base | Prerequisite for `time-controls.md`, which the index says build first | medium |
| 8 | S13 rack thermal budget | Needs S2 landed before re-tuning | medium |
| 9 | S5 capacity invariant | Latent; cheap to make loud now | small |
| 10 | S4 PendingDrop | Decide: implement or delete | small |

S8 and S11 are the symptoms; they should resolve once S9, S10 and S2 are fixed, and are worth
re-measuring rather than tuned directly.

## 5. Status

Fixed on `claude/simulation-playtest-fixes`: S1, S2, S3, S4, S5, S6, S7, S10, S12.

**S9 needed no change.** It was a consequence of S10, not an independent problem. With demand
size clamped to the player's own fleet, average revenue per second by reputation band is now
monotonically increasing (8.12 at 0-19, 18.21 at 20-39, 19.85, 19.98, 22.25 at 80-99), and a
player who accepts everything and tanks their reputation finishes 30 minutes at -$8,693 against
a careful player's +$11,352 on the same seed — the reverse of the measurement that produced S9.
`pickArchetype`'s 1..n weighting is left alone: the displacement it causes is progression now
that the archetypes it unlocks are actually servable.

**S8 and S11 resolved with it.** Share of offers the player's own hardware can serve went 12% ->
73-79%; a buying player's 30-minute balance went -$9..$77 -> $9.2k..$12.0k against a
buy-nothing baseline of $1.9k, so building now returns roughly six times doing nothing. The
runaway in S11 is no longer reachable from one unstated trick, because the trick is no longer
required.

**S13 is open and is a tuning decision, not a defect.** S2 removed the cliff it described: a
rack now degrades smoothly (2 Blade Chassis at full speed, 3 at x0.78, 6 at x0.38) instead of
tripping. What remains is that `RACK_SLOT_CAPACITY` is 6 while the economic optimum for the top
tier is 2, and that CRAC units are strictly dominated by simply buying another $120 rack — on
capex *and* on floor space:

| 6 Blade Chassis running Render Farm | racks | CRACs | cells | capex | throttle | net $/s per $1k |
| --- | --- | --- | --- | --- | --- | --- |
| 1 per rack, no CRAC | 6 | 0 | 6 | $6,120 | 1.00 | 4.35 |
| **2 per rack, no CRAC** | 3 | 0 | **3** | **$5,760** | **1.00** | **4.63** |
| 3 per rack, no CRAC | 2 | 0 | 2 | $5,640 | 0.78 | 3.65 |
| 6 per rack, no CRAC | 1 | 0 | 1 | $5,520 | 0.38 | 1.69 |
| 6 per rack, 4 CRACs | 1 | 4 | 5 | $7,320 | 0.97 | 3.43 |
| 3 per rack, 2 CRACs | 2 | 4 | 6 | $7,440 | 1.00 | 3.49 |

Every CRAC layout is beaten by spreading out, so the mechanic meant to make heat a spatial
problem currently has no use case. Fixing that means choosing what the rack is for — see the
options discussed with the change author before picking one.
