# Research tree: permanent choices the player owns

> **Plan 12.** Depends on `.plans/facility-shop-inventory.md` (shop panel, purchase flow).
> Best built **after** `.plans/thermal-and-cooling.md`, `.plans/power-billing.md`, and
> `.plans/hardware-failure.md`, because the most interesting nodes modify constants those
> plans introduce. Building it first yields a tree of nodes that tweak two numbers.
>
> Lowest priority of the mechanical plans. It adds progression *texture*, not a new decision
> loop — take it once the loop underneath is worth investing in.

## Context

Progression today is entirely "buy a bigger thing": more racks, better machine tiers, more
power, more cooling, a larger room. Every purchase is consumable and repeatable, and none of
them is a *choice* — given enough money the player buys all of them, in roughly one order.

There is no permanent, exclusive decision that makes one player's facility different from
another's. That is what a research tree provides, and it is why the trade-offs between nodes
matter more than the nodes themselves.

---

## Design decisions

### D1. Research points come from completed contracts, not from time or money

```ts
export interface Research {
  points: number;
  unlocked: Set<NodeId>;
}
```

Earned per contract completion in `workload-run.ts`, where `contractsServed` already
increments. Scale by contract size so serving big workloads advances research faster.

Not time-based (which would reward idling) and not money-bought (which would make research a
second money sink competing with hardware, and make the richest strategy also the most
advanced). Tying points to *work done* means research follows engagement with the core loop.

### D2. The tree is small, shallow, and partly exclusive

**Ten to twelve nodes, maximum**, in three branches, at most three deep.

The important structural decision: **at least one branch offers exclusive choices** — picking
one node locks its sibling. Without exclusivity the tree is a checklist the player eventually
completes, and it stops being a decision the moment they can afford everything.

Suggested shape, assuming the other plans shipped:

| Branch | Nodes |
| --- | --- |
| **Efficiency** | −15% machine power draw → −25% cooling draw → *exclusive:* `Free Cooling` (CRAC output +50%) **or** `Hot Aisle Containment` (heat generation −30%) |
| **Operations** | Install/repair 40% faster → +1 rack slot → *exclusive:* `Predictive Maintenance` (wear −40%) **or** `Hot Swap` (repairs need no walk) |
| **Capacity** | Unlock a new server tier → +1 concurrent offer (`MAX_OFFERS`) → unlock a new archetype |

Each exclusive pair should represent a genuinely different facility: one player runs cool and
dense, another runs hot and repairs constantly. That is the payoff.

### D3. Nodes modify constants through a single accessor layer

This is the load-bearing engineering decision. Constants in `game-data.ts` are imported
directly all over the codebase — `MACHINE_TIERS[...].powerKw`, `BROWNOUT_COOLDOWN_SECONDS`,
`REPAIR_BASE_SECONDS`. If research mutates them, it mutates module-level state shared by
everything, which is untestable and makes a future save/restart impossible.

Instead, add **one module** that answers "what is this value, for this facility, right now":

```ts
// src/ecs/modifiers.ts
export function machinePowerKw(world: World, facility: EntityId, tierId: MachineTierId): number
export function coolingOutputKw(world: World, facility: EntityId, base: number): number
export function wearRatePerSecond(world: World, facility: EntityId): number
export function installSeconds(world: World, facility: EntityId, base: number): number
export function rackSlotCapacity(world: World, facility: EntityId): number
export function maxOffers(world: World, facility: EntityId): number
```

Each reads `Research.unlocked` and applies multipliers to the base constant. Systems call
these instead of reading the constant directly.

The cost is honest and should be stated: **every system that a research node touches must be
converted to go through this layer.** That is the real work of this plan — the tree data and
UI are straightforward. Convert only the call sites the shipped nodes actually need; do not
pre-emptively route every constant through it.

Precedent: `traits.ts` and `thermal.ts` already establish "one module owns this arithmetic".
This is the same pattern applied to configuration.

### D4. Research is bought at the shop, in a new tab

The shop panel already has tabs and a row-with-buy-button layout
([layout.ts:396-428](src/ui/layout.ts#L396-L428)), and `PURCHASABLES` already supports an
`'instant'` kind that applies immediately with no inventory
(`.plans/facility-shop-inventory.md` D6).

Research nodes are `'instant'` purchases paid in **points rather than money**. That is the one
extension needed: `PurchasableDef` grows an optional `pointCost`, and the shop's affordability
check consults `Research.points` for those entries.

No new panel, no new screen, no new input chain. The tree is a list grouped by branch with
locked entries greyed out. A graphical tree with connecting lines is nicer and is not worth it
for twelve nodes.

### D5. Unlocks are permanent and irreversible

No respec. A locked-out sibling stays locked. This is what gives the choice weight, and it is
also what makes it a *choice* rather than an ordering problem.

Say so clearly in the UI at the point of purchase — an exclusive pick needs a confirm step,
like decommissioning does in `.plans/hardware-failure.md`.

---

## Step 1 — points

1. `Research { points, unlocked }` on the facility; `spawnFacility` initializes it.
2. `workload-run.ts` awards points on completion, alongside `contractsServed`.
3. HUD shows the point total. Without a visible counter, research is invisible until the
   player happens to open the shop tab.

Ship this alone first if you like — a visible counter that does nothing is a poor feature, so
pair it with step 2 at minimum.

## Step 2 — tree data

`game-data.ts`:

```ts
export type ResearchNodeId = string;

export interface ResearchNodeDef {
  id: ResearchNodeId;
  label: string;
  description: string;      // player-facing: what it actually does
  branch: 'efficiency' | 'operations' | 'capacity';
  pointCost: number;
  requires: ResearchNodeId[];     // all must be unlocked
  excludes: ResearchNodeId[];     // unlocking this permanently locks these
}

export const RESEARCH_NODES: ResearchNodeDef[] = [ /* per D2 */ ];
```

`description` is player-facing and must state the effect concretely ("Machines draw 15% less
power"), not flavor. A node whose effect the player cannot verify will be assumed broken.

## Step 3 — `src/ecs/modifiers.ts`

Per D3. Pure reads of `Research` plus base constants; no mutation, no side effects.

Add a short comment stating the rule: *systems read gameplay constants through this module,
never directly from `game-data.ts`, whenever a research node can affect them.*

## Step 4 — convert call sites

Only what the shipped nodes need. Expect roughly:

- `resource.ts` — machine power/cooling draw
- `thermal.ts` — CRAC output, heat generation
- `wear.ts` — wear rate
- `maintenance.ts` — install/repair duration
- `capacity.ts` / `entities.ts` — rack slot capacity
- `workload-spawn.ts` — `MAX_OFFERS`

Do this branch by branch alongside the node that needs it, not as one sweeping refactor.

## Step 5 — shop tab

1. `PurchasableDef` gains optional `pointCost`; research nodes are `'instant'` kind.
2. A `Research` tab in the shop, grouped by branch.
3. Rows show cost, description, and state: available / locked (unmet requirement) / purchased /
   **locked out** (an exclusive sibling was taken).
4. Confirm step on exclusive picks (D5).
5. `shop.ts` handles point-denominated purchases and applies the unlock.

## Step 6 — tuning

1. **First node reachable in a few minutes** of decent play — early enough to teach that the
   system exists.
2. **The full tree is not completable in one session.** If it is, exclusivity is the only thing
   making choices matter, and one branch will be strictly dominant.
3. **Each exclusive pair is genuinely contested.** If everyone picks the same side, the numbers
   are wrong. This is the pass/fail test for the plan.
4. **No node is mandatory.** A node that is always correct first is not a choice; fold it into
   the base game instead.

---

## Files

| File | Change |
| --- | --- |
| `src/ecs/modifiers.ts` | **new** — research-aware constant accessors |
| `src/ecs/game-data.ts` | `RESEARCH_NODES`; `PurchasableDef.pointCost` |
| `src/ecs/components.ts` | `Research` |
| `src/entities/index.ts` | facility gets `Research` |
| `src/ecs/systems/workload-run.ts` | award points on completion |
| `src/ecs/systems/shop.ts` | point purchases, unlock + exclusion |
| `src/ui/layout.ts` | research tab/row rects |
| `src/ecs/systems/render.ts` | research tab rendering |
| `src/ecs/systems/hud.ts` | point counter |
| *various systems* | read through `modifiers.ts` (step 4) |

## Trade-offs worth flagging

- **The accessor layer is the real cost.** Twelve nodes of data and a list UI are easy; routing
  constants through a lookup touches many systems and adds indirection to code that is
  currently direct and obvious. Convert incrementally, per node.
- **Research competes with hardware for attention, not money.** Points are a separate currency
  (D1) precisely to avoid a second money sink, but watch that the player is not simply ignoring
  the shop tab. If they are, the nodes are too weak.
- **Exclusivity will frustrate some players.** That is the intent (D5), but it means node
  descriptions must be unambiguous *before* purchase. An exclusive choice made on a misread
  description is a bad experience, not an interesting one.
- **Build last.** Half these nodes modify constants from plans 9-10. Building the tree first
  means a tree with nothing interesting to modify.

## Verification

Per CLAUDE.md: no browser automation, no starting the project from here — manual validation.

1. `npx tsc --noEmit` clean after each step.
2. **Points accrue** on contract completion, scaled by size, and are visible in the HUD.
3. **Requirements gate correctly:** a node with an unmet `requires` cannot be bought.
4. **Exclusion is permanent:** taking one sibling greys the other out for good, and it stays
   locked after further purchases.
5. **Effects are real and measurable:** after the −15% power node, HUD power draw drops by
   ~15% with no other change. Verify each shipped node the same way — a node whose effect you
   cannot observe is indistinguishable from a bug.
6. **Insufficient points** rejects the purchase without partially applying it.
7. **No direct-constant leaks:** after step 4, grep for direct imports of any constant a node
   modifies and confirm the affected systems go through `modifiers.ts`.
