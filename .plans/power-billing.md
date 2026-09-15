# Power billing: making efficiency a stat

> **Plan 8.** Depends on nothing; pairs naturally with `.plans/time-controls.md` (tuning an
> income curve is far easier with fast-forward). Touches `src/ecs/game-data.ts`,
> `src/ecs/systems/resource.ts`, `src/ecs/components.ts`, and `src/ecs/systems/hud.ts`.
> One new component field group, no new systems.

## Context

Power today is a **wall, not a cost**. `POWER_UPGRADE_COST = 400` buys `+5kW` of capacity once
([game-data.ts](src/ecs/game-data.ts)); after that, running at 4.9kW costs exactly the same as
running at 0.1kW. `resource.ts` computes `utilization.powerDrawKw` every tick
([resource.ts:135-136](src/ecs/systems/resource.ts#L135-L136)) and then uses it only to decide
brownouts.

The consequence is a balance hole that undermines the server catalog. `MACHINE_TIERS` is
deliberately lopsided so tier choice is a real decision — the comment in
[game-data.ts:32-40](src/ecs/game-data.ts#L32-L40) says as much. But since power is free once
bought, **the dominant strategy is always the highest-trait machine you can afford**. A Blade
Chassis (32 CPU, 1.6kW) versus a Storage Array (6 CPU, 0.5kW) is currently no contest for any
workload the Blade can hold, because its 3.2x power draw costs nothing per second.

Add a per-second power bill and that inverts: the Storage Array serving a `render` job it
exactly fits becomes genuinely more profitable than a Blade doing the same job. Efficiency
becomes a stat the player optimizes, and `budget`/`storage`/`memory` tiers earn their place.

This is the highest balance-effect-per-line change available. The core of it is one line in
`resource.ts`.

---

## Design decisions

### D1. The bill is charged on *draw*, not on capacity

```ts
wallet.money -= utilization.powerDrawKw * POWER_COST_PER_KW_SECOND * deltaSeconds;
```

Charging for installed capacity instead would punish the player for headroom, which is exactly
what you want them to buy before a brownout. Charging for draw means an idle machine still
costs (it is powered on) but an *unbuilt* one does not.

Note this makes `powerKw` a per-tick recurring cost while `MachineTierDef.cost` stays a
one-off. That is the intended tension: a cheap machine with bad efficiency is now a slow leak.

### D2. Cooling draw is billed at the same rate, not separately

`utilization.coolingDrawKw` is already tracked alongside power. Bill
`powerDrawKw + coolingDrawKw` at one rate rather than inventing a second tariff. Cooling is
electrically powered; two rates would be two numbers to tune for no added decision.

This also means `WORKLOAD_ARCHETYPES[].coolingBonusKw` (currently 0.8 for `render`, 2.2 for
`training`) finally has an economic bite: a hot workload now costs more to run, which is a
direct nudge toward the cooling efficiency research in
`.plans/research-tree.md` and the CRAC placement in `.plans/thermal-and-cooling.md`.

### D3. Offline machines are not billed

`resource.ts` already `continue`s past offline machines before accumulating draw
([resource.ts:119](src/ecs/systems/resource.ts#L119)), so a browned-out machine contributes
zero draw and is billed nothing. This falls out for free and is the correct behavior — a
brownout should reduce your bill, which is a small, legible mercy during a cash crisis.

### D4. Money may go negative; bankruptcy is out of scope for this plan

A player who over-builds can now drain the wallet. This plan does **not** add a lose
condition — that is a separate design decision and belongs with a proper failure/restart flow.

For now: allow negative money, and make it loud in the HUD (red, minus sign). Purchases
already check `canAfford` at the shop, so a negative balance naturally locks out buying, which
is a soft failure state the player can recover from by letting contracts complete.

Flagging explicitly: **a player can reach an unrecoverable state** — negative money, no
contracts running, a bill draining faster than they can earn. The escape hatch is selling
hardware, which arrives in `.plans/hardware-failure.md` step 6. If you build this plan first
and play it, keep `POWER_COST_PER_KW_SECOND` low enough that the drain is slow, or accept that
early playtests can dead-end.

### D5. The HUD shows net, not gross

The single most important part of this plan is not the deduction — it is **showing the
player the deduction**. A bill they cannot see is just a mysteriously slower income curve.

The HUD gains a net income rate: `revenue/s − power cost/s`, colored green or red. This makes
the tier trade-off *visible*, which is the whole point. Without it, the mechanic is invisible
and feels like a nerf.

### D6. Rate is one constant, tuned against the cheapest profitable contract

```ts
export const POWER_COST_PER_KW_SECOND = 0.05;
```

Sanity-check the starting position: a `basic` server (0.4kW power + 0.3kW cooling = 0.7kW)
costs `0.7 × 0.05 = 0.035/s`. A `web` contract pays `0.9/s`. So a busy `basic` server nets
~0.865/s — power is ~4% of revenue, a rounding error.

Now an idle facility: 6 `basic` servers idling cost `6 × 0.035 = 0.21/s`, or ~12.6/minute
against `STARTING_MONEY = 750`. Slow, survivable, but real.

And the tier comparison that matters: a `dense` Blade (1.6 + 1.4 = 3.0kW → 0.15/s) versus a
`storage` Array (0.5 + 0.4 = 0.9kW → 0.045/s) on the same `render` contract paying 5.2/s. The
Blade nets 5.05/s, the Array nets 5.155/s. **That gap is too small to change behavior.**

So `0.05` is a starting point that is almost certainly too low to achieve the plan's goal.
Step 5 is a real tuning step, not a formality. Expect to land somewhere in `0.15`–`0.3`,
where the Blade/Array gap on a `render` job becomes ~0.3–0.6/s — 6-12% of the contract value,
enough to notice across a dozen placements. Tune it by the *ratio of power cost to contract
revenue*, targeting roughly **10–20% of gross revenue** at healthy utilization.

---

## Step 1 — the constant and the utilization field

`game-data.ts`:

```ts
// Charged per second on (powerDrawKw + coolingDrawKw). See .plans/power-billing.md D6 —
// tuned so power is ~10-20% of gross revenue at healthy utilization, which is what makes a
// low-draw tier a genuine alternative to the highest-trait tier the player can afford.
export const POWER_COST_PER_KW_SECOND = 0.2;
```

`components.ts`, extend `Utilization` (a derived cache, recomputed every frame — same
discipline as the existing fields):

```ts
export interface Utilization {
  powerDrawKw: number;
  coolingDrawKw: number;
  // ... existing ...
  powerCostPerSecond: number;   // derived: (power + cooling) * POWER_COST_PER_KW_SECOND
  revenuePerSecond: number;     // derived: sum of payPerSecond over running workloads
}
```

Both are caches for the HUD. Keeping them on `Utilization` rather than recomputing in `hud.ts`
holds to the existing rule that the HUD only reads and draws.

## Step 2 — charge the bill in `resource.ts`

At the end of `createResourceSystem`'s update, after `powerDrawKw`/`coolingDrawKw` are
accumulated and assigned:

```ts
utilization.powerCostPerSecond = (powerDrawKw + coolingDrawKw) * POWER_COST_PER_KW_SECOND;

const wallet = world.getComponent(wallets, facility);
if (wallet) wallet.money -= utilization.powerCostPerSecond * deltaSeconds;
```

`resource.ts` does not currently import `wallets` — add it.

**Why `resource.ts` and not `workload-run.ts`:** the bill is a property of what is *powered
on*, not of what is *running work*. A facility of idle servers must still be billed, and
`workload-run` only iterates workloads. `resource.ts` is also already the sole owner of
`powerDrawKw`, so the charge sits next to the number it derives from.

**Ordering is already correct:** `resource` runs before `capacity` and `workload-run`
([main.ts:56-71](src/main.ts#L56-L71)), so the bill and the income land in the same tick with
the bill first. No ordering change needed.

## Step 3 — revenue rate for the HUD

`revenuePerSecond` is most naturally computed in `workload-run.ts`, which already iterates
every workload and knows which are placed on an online server. Accumulate there and assign to
`utilization.revenuePerSecond` at the end of its update.

This means `workload-run` now writes to `Utilization`, which `capacity.ts` and `resource.ts`
also write to. That is acceptable — they write disjoint fields — but note it in a comment on
the field so nobody assumes `capacity.ts` owns the whole component.

## Step 4 — HUD

In `hud.ts`, in the top bar:

- **Money**: red with a `-` when negative (currently assumes positive).
- **Net rate**: `+2.4/s` green, or `-0.8/s` red. This is `revenuePerSecond − powerCostPerSecond`.
- **Power row**: extend the existing power display to show the cost, e.g.
  `Power 3.2 / 5.0 kW  (-0.64/s)`.

Optional and worth it: on the rack panel's server rows, show each machine's own draw cost.
That turns the abstract "efficiency matters" into a per-machine number at the exact moment the
player is deciding where to put a workload.

## Step 5 — tuning pass (the actual work)

With `.plans/time-controls.md` fast-forward, run the loop and check:

1. **Early game is not strangled.** Starting with 750 money and one or two servers, the bill
   must be clearly survivable while the player walks to the shop and back.
2. **Idle facilities bleed.** A player who buys ten servers and accepts no contracts should
   visibly lose money. This is the mechanic working.
3. **The tier trade-off actually flips.** Concretely: take a `render` contract (demands
   cpu 6 / ram 20 / storage 800) and confirm that placing it on a `storage` Array is
   *noticeably* more profitable per second than on a `dense` Blade. If the difference is under
   ~5% of contract value, raise the rate. **This is the pass/fail test for the whole plan.**
4. **`budget` tier finds a niche.** At 0.35kW total it should be the correct choice for `web`
   contracts, which pay only 0.9/s.
5. **Re-check `getComputeScale`.** Escalation assumes an income curve that this plan bends
   downward. If growth now outruns income, the lever is this rate, not the escalation curve —
   change one variable at a time.

---

## Files

| File | Change |
| --- | --- |
| `src/ecs/game-data.ts` | `POWER_COST_PER_KW_SECOND` |
| `src/ecs/components.ts` | `Utilization` gains `powerCostPerSecond`, `revenuePerSecond` |
| `src/ecs/systems/resource.ts` | import `wallets`; compute cost; deduct per tick |
| `src/ecs/systems/workload-run.ts` | accumulate `revenuePerSecond` |
| `src/ecs/systems/hud.ts` | net rate, negative money styling, power cost readout |
| `src/ecs/systems/rack-panel.ts` | *(optional)* per-server draw cost on each row |

## Trade-offs worth flagging

- **This is a nerf before it is a feature.** Every existing playtest gets poorer. Expect the
  first play after this change to feel worse until step 5's tuning lands. Do not judge the
  mechanic before tuning the rate.
- **An unrecoverable negative-money state exists** until selling hardware ships
  (`.plans/hardware-failure.md` step 6). Accepted deliberately, per D4 — but if playtests keep
  dead-ending, ship the sell action before tuning the rate upward.
- **Two derived fields now live on `Utilization` written by two different systems.** Watch it.
  A third writer means `Utilization` should be split by owner.
- **The rate interacts with every later plan.** Thermal throttling reduces draw (and thus the
  bill) as a side effect; research efficiency nodes multiply it. Re-tune after each, and keep
  this constant as the single lever.

## Verification

Per CLAUDE.md: no browser automation, no starting the project from here — manual validation.

1. `npx tsc --noEmit` clean after each step.
2. **Bill accrues:** with servers online and no contracts, money falls steadily at exactly the
   rate the HUD shows.
3. **Brownout reduces the bill:** force a brownout by over-installing; confirm the per-second
   cost drops as machines go offline (D3).
4. **Net rate is arithmetically right:** `net = revenue − cost`, matching the money delta over
   a 10-second observation.
5. **No double-charge at speed:** at 4x, money drains 4x faster in wall-clock but the same
   amount per *simulated* second — the classic sign of a wall-clock read instead of a delta.
6. **The tier flip (the real test):** same `render` contract on `storage` vs `dense` — the
   `storage` placement is visibly more profitable.
7. **Negative money:** shop purchases are rejected; HUD shows red; the game does not crash or
   soft-lock in any other way.
