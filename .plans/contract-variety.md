# Contract variety: making "accept" a real decision

> **Plan 11.** Depends on `.plans/workload-dispatch.md` (offers, tray, drag-and-drop, traits).
> Touches `game-data.ts`, `components.ts`, `dispatch.ts`, `workload-run.ts`,
> `workload-spawn.ts`, and the offer/tray rendering. No new systems for steps 1–3.
>
> The cheapest plan here that adds a genuinely new *decision* rather than a new constraint.
> Steps 1 and 2 are independent and each worth shipping alone.

## Context

`.plans/workload-dispatch.md` built an accept/decline gate and called it "the actual
difficulty dial". It is not — yet. `REPUTATION_ON_DECLINE = 0` makes declining free, and
accepting has no downside beyond opportunity cost, so **accept everything, place what fits,
let the rest expire** is strictly optimal. A missed deadline costs 8 reputation, which
regenerates at 3 per completion; the arithmetic does not punish over-acceptance.

Meanwhile all four archetypes are the same *kind* of object — a lump of work with a deadline,
differing only in numbers. `WORKLOAD_ARCHETYPES` varies demands, pay, and duration
([game-data.ts](src/ecs/game-data.ts)), but structurally a `web` job and an `ML Training` job
are identical: place once, wait, collect.

Two changes fix both problems, and they compose: **penalties** make accepting a commitment,
and **recurring contracts** make capacity something you commit rather than something you fill.

---

## Design decisions

### D1. Penalties make acceptance a commitment

Add to `WorkloadArchetypeDef`:

```ts
penaltyOnMiss: number;   // money lost if the deadline passes after acceptance
```

Missing a deadline now costs cash, not just reputation. The offer card shows it before the
player accepts.

This is what turns accept/decline into a real choice. Right now a marginal contract is free to
take. With a penalty, accepting is a bet on having capacity in `deadlineSeconds`, and declining
is a legitimate, sometimes correct play — which is exactly what
`.plans/workload-dispatch.md`'s "New loop" claimed but did not deliver.

Scale the penalty with the archetype's value: high-paying `training` contracts should carry the
scariest penalty. A reasonable starting shape is `payPerSecond × workSeconds × 0.5` — roughly
half the contract's gross — so a miss hurts about as much as a success helps.

**The penalty applies only to accepted work.** An expired *offer* stays free (`offerSeconds`
running out is a silent decline). Never punish the player for a decision they did not make.

### D2. Recurring contracts commit capacity over time

```ts
repeatCount: number;      // on Workload: how many more cycles after this one
repeatTotal: number;      // for display: "3 / 5"
```

On completion, instead of destroying the workload: if `repeatCount > 0`, decrement it, reset
`workRemainingSeconds` and `deadlineRemainingSeconds`, pay out, and **leave it placed on the
same server**. Only when the last cycle finishes is it destroyed.

This is the single best structural addition available, because it introduces the concept the
game currently lacks: **committed capacity**. Today every placement is temporary and the
facility trends toward empty. With recurrences, a server hosting a 5-cycle contract is spoken
for, and the decision "do I have room for this?" means "for the next several minutes", not
"right now".

It also makes the trait-fit puzzle interesting again late-game: with most capacity committed,
the marginal free slot is genuinely scarce.

**Leave it placed on completion, do not return it to the tray.** Returning it would force the
player to re-drag the same job repeatedly — busywork that teaches nothing. Staying placed means
recurrence is a *reward* (steady income, no attention) balanced by a *cost* (locked capacity).

Pair recurrence with a lower `payPerSecond` than one-shot contracts of the same size: the
player is trading rate for certainty. That trade is the decision.

### D3. Recurrence interacts with brownouts, throttling, and failure — deliberately

If a server browns out or fails mid-recurrence, `unplaceAllOn` returns the workload to the
tray with its `repeatCount` intact. The player can re-place it on another server and the
contract continues.

This is the right behavior and worth stating: a long recurring contract becomes a *liability*
during an outage, not just lost income — it is occupying tray space and burning a deadline
while unplaced. That is a good interaction with every other plan in this set, and it arrives
for free from the existing `unplaceWorkload` path.

### D4. Clients are a light wrapper, not a relationship sim

```ts
export interface ClientDef { id, label, favoredArchetypes, reputationWeight }
```

An offer is attributed to a named client. Completing their work raises standing with them
specifically; missing it lowers it. Standing gates their better contracts.

Deliberately shallow: **no per-client entity, no negotiation, no client-specific UI beyond a
name on the card.** Store standing as a `Partial<Record<ClientId, number>>` on the facility,
exactly as `Inventory` stores counts (D5 of `.plans/facility-shop-inventory.md`).

The whole value is fiction and memory — "Northwind always wants storage jobs and I keep letting
them down" is a story the player constructs from a name and a number. That costs almost
nothing to build and does most of the work of a relationship system.

Build this last, and only if the game still feels anonymous after steps 1–2.

### D5. Multi-server contracts are explicitly deferred

Splitting one workload across several servers would make big racks meaningful and is the
obvious fourth idea. It is **not** in this plan's steps, because it breaks the invariant
`.plans/workload-dispatch.md` D1 was built on: *one workload occupies exactly one server*.

`PlacedOn { serverId }` would become a list; `checkPlacement`, `placeWorkload`,
`unplaceWorkload`, `capacity.ts`'s per-server demand fold, the rack panel's chips, and the drag
interaction all assume 1:1. That is a data-model migration, not a feature — comparable in size
to the dispatch plan itself.

Reconsider it only after recurrence ships, because recurrence already delivers the
"my capacity is committed" feeling that multi-server contracts were wanted for, at a fraction
of the cost.

---

## Step 1 — penalties (smallest useful increment)

1. `WorkloadArchetypeDef` gains `penaltyOnMiss`; fill in all four archetypes per D1.
2. `Offer` and `Workload` carry it through (`spawnOffer` in `entities/index.ts`, `acceptOffer`
   in `dispatch.ts`).
3. `workload-run.ts`, in the deadline-miss branch
   ([workload-run.ts:47-51](src/ecs/systems/workload-run.ts#L47-L51)):
   `wallet.money -= workload.penaltyOnMiss` alongside the reputation hit.
4. **Offer card** shows the penalty prominently — it is the number the accept decision turns
   on, so it must be at least as visible as the pay.
5. **Tray card and HUD workload row** show it too, so an at-risk contract reads as urgent.

Scaling: `penaltyOnMiss` must scale with `getComputeScale` the same way `payPerSecond` and
`demands` do for `scales: true` archetypes, or late-game penalties become trivial.

## Step 2 — recurring contracts

1. `WorkloadArchetypeDef` gains `repeatRange: [min, max]` (use `[0, 0]` for one-shot
   archetypes).
2. `spawnOffer` rolls the count; `Offer` and `Workload` carry `repeatCount`/`repeatTotal`.
3. `workload-run.ts`, in the completion branch
   ([workload-run.ts:36-46](src/ecs/systems/workload-run.ts#L36-L46)):

```ts
if (workload.workRemainingSeconds <= 0) {
  reputation.value = clampReputation(reputation.value + REPUTATION_ON_COMPLETION);
  clock.contractsServed += 1;
  clock.peakComputeServed = Math.max(clock.peakComputeServed, workload.demands.cpu);

  if (workload.repeatCount > 0) {
    workload.repeatCount -= 1;
    workload.workRemainingSeconds = workload.workSeconds;
    workload.deadlineRemainingSeconds = archetype.deadlineSeconds;
    continue;                      // stays placed, stays running (D2)
  }

  world.removeComponent(placedOns, workloadId);
  world.destroyEntity(workloadId);
  continue;
}
```

⚠️ Note `clock.contractsServed` now increments per *cycle*. Decide deliberately whether that
is the intent — it feeds nothing but display today, but `peakComputeServed` feeds
`getComputeScale` and therefore difficulty. Incrementing per cycle is fine for
`peakComputeServed` (the capacity really was served) but inflates `contractsServed` as a score.
Split them if the score should count contracts, not cycles.

4. **Render the cycle count** on the placed chip and tray card: `Web Hosting 3/5`. Without it,
   a contract that refuses to disappear looks like a bug.
5. Offer cards must clearly mark recurring contracts — this is the main thing the player is
   evaluating, since it determines how long their capacity is committed.

## Step 3 — tuning the accept decision

The goal is that **declining is sometimes correct**. Verify by playing:

1. A contract that does not fit any current server, with a real penalty, should be an obvious
   decline. Today it is a free accept.
2. A large recurring contract when nearly full should be a genuine dilemma — steady income
   versus flexibility.
3. Reputation should still matter: too many declines slows arrivals via
   `getArrivalInterval`, so pure cherry-picking must not be free either. Check the current
   formula actually delivers that pressure; if declining costs nothing at all, consider a
   small reputation cost for declining *after* penalties exist — the D-note in `game-data.ts`
   argued zero was right only because there was no other downside to accepting.

## Step 4 — clients (optional, last)

Per D4: a `CLIENTS` table in `game-data.ts`, a `ClientStanding` component on the facility, a
name on the offer card, and standing adjustments where reputation is already adjusted in
`workload-run.ts`. Gate an archetype or a pay bonus behind standing.

Stop there. Resist per-client contract terms, negotiation, or a client screen.

---

## Files

| File | Change |
| --- | --- |
| `src/ecs/game-data.ts` | `penaltyOnMiss`, `repeatRange`, optional `CLIENTS` |
| `src/ecs/components.ts` | `Offer`/`Workload` gain penalty + repeat fields |
| `src/entities/index.ts` | `spawnOffer` rolls repeats, scales penalty |
| `src/ecs/dispatch.ts` | `acceptOffer` carries the new fields |
| `src/ecs/systems/workload-run.ts` | penalty on miss; recurrence on completion |
| `src/ecs/systems/render.ts` | penalty + cycle count on offer/tray/chip |
| `src/ecs/systems/hud.ts` | penalty and cycles in the workload rows |

## Trade-offs worth flagging

- **Penalties can spiral.** A player already short on capacity accepts, misses, pays, and is
  now shorter on cash. That is a legitimate difficulty curve *only* if declining is obviously
  available and clearly signposted. Make the decline button as prominent as accept.
- **Recurrence can starve the tray.** If most capacity is committed to recurring work, new
  offers become unacceptable and the game stalls. Watch for this in tuning; the lever is
  `repeatRange` and the recurring/one-shot mix, not `MAX_OFFERS`.
- **`contractsServed` semantics change** (step 2). Small, but it feeds the difficulty curve —
  do not let it slip through unexamined.
- **Multi-server contracts stay deferred** (D5). If a future plan wants them, budget it as a
  data-model migration on the scale of `workload-dispatch.md`, not as a feature.

## Verification

Per CLAUDE.md: no browser automation, no starting the project from here — manual validation.

1. `npx tsc --noEmit` clean after each step.
2. **Penalty fires once** on a missed deadline, for the amount shown on the card, alongside
   the reputation hit.
3. **An expired offer costs nothing** — no penalty, no reputation change (D1).
4. **Recurrence:** a 3-cycle contract pays three times, stays on the same server throughout,
   shows a decreasing counter, and is destroyed only after the last cycle.
5. **Recurrence survives displacement:** brown out its server mid-contract; it returns to the
   tray with `repeatCount` intact and continues when re-placed (D3).
6. **The deadline resets per cycle** — a recurring contract does not inherit the previous
   cycle's remaining time.
7. **Declining is sometimes correct:** a no-fit contract with a large penalty is clearly
   better declined, and the UI makes that legible without arithmetic.
8. **Scaling:** late-game penalties scale with `getComputeScale` for `scales: true` archetypes.
