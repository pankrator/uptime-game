# Workload dispatch: traits, acceptance, and manual placement

> **Plan 4.** Supersedes the auto-assignment half of `.plans/workload-economy.md` and the
> pending-queue half of `.plans/hud-and-escalation.md`. Depends on
> `.plans/machines-and-racks.md` (facility singleton, racks, `Powered`, `game-data.ts`) and
> `.plans/pathfinding-collision.md` (the player must walk to a rack to dispatch).

## Context

Plans 1-3 built a game where the player's only verb is **building capacity**. Contracts arrive
on their own, `workload-assign.ts` packs them onto whatever machines are free, and the player
never touches a workload. `.plans/workload-economy.md` argued this explicitly:

> **Auto-assignment is a deliberate choice.** The player's job is building capacity, not
> playing dispatcher. Manual assignment would add a whole selection UI to make the player
> execute an algorithm they'd run identically every time.

**This plan reverses that decision.** The premise no longer holds, because two changes make
dispatch a real decision rather than a re-run of the same algorithm:

1. **Servers have multiple traits** (CPU, RAM, Storage) instead of one scalar `compute`.
   Packing a mixed set of workloads onto a mixed set of servers is a bin-packing problem with
   no single obvious answer. A CPU-heavy job and a RAM-heavy job *should* go on different
   servers, and the player has to see that.
2. **Workloads are accepted, not merely received.** Turning down a contract you cannot serve
   is now a live decision with a reputation cost attached to guessing wrong.

Dispatch becomes the core verb. Building capacity becomes the thing you do *between* dispatch
decisions.

### New loop

```
CONTRACT OFFERED  (arrives on the demand clock; shows CPU/RAM/Storage and pay)
  ├─ DECLINE  → gone, no penalty. The safe out when you're full.
  └─ ACCEPT   → enters the tray. Finish deadline starts ticking NOW.
                  ↓
        player WALKS to a rack, opens its panel, DRAGS the job onto a server
          ├─ fits in that server's free CPU/RAM/Storage? → runs, pays $/sec
          └─ doesn't fit?                                → drop rejected, stays in tray
                  ↓
        job finishes before its deadline  → money + reputation
        deadline passes (in tray OR mid-run) → reputation loss
                  ↓
        money buys racks/servers/power/cooling → more and better-shaped capacity
                  ↓
              (demand keeps escalating — endless)
```

The accept/decline gate is the real difficulty dial. Reputation is no longer lost by demand
outrunning you passively; it is lost by **your own misjudged acceptance**. That is a fairer,
more legible failure than the current model.

---

## Design decisions

These were settled up front; they constrain everything below.

### D1. One workload occupies exactly one server

A workload has fixed CPU/RAM/Storage demands and must fit **entirely** within one server's
free capacity. A server hosts many workloads until any one of its traits is exhausted.

Rejected alternative: splitting a workload across servers (what `selectMachinesForWorkload`
does today). It would force a shard/replica concept into the drag UI — the player would drag
*pieces* of a job, and every panel would need partial-fill state. The cost is not worth it at
this game's scale.

Consequence: **`selectMachinesForWorkload` and `workload-assign.ts` are deleted, not
extended.** A workload that no single server can hold is simply unplaceable, and the player
should have declined it. This is the intended pressure.

### D2. A single finish deadline, not separate start and finish deadlines

Accepting starts one clock: `deadlineRemainingSeconds`. It ticks whether the job is sitting in
the tray or running on a server. The job must *complete* before it hits zero.

This folds the "deadline to start" into the same number — sitting unplaced burns your own
margin, with no separate penalty or second timer to display and tune. A job accepted with a
90s deadline and a 60s runtime gives you 30s of walking-and-dispatching slack, and the player
can read that directly off one countdown.

Consequence: the `graceRemainingSeconds` / `elapsedSeconds` / `durationSeconds` triple
collapses into `deadlineRemainingSeconds` + `workRemainingSeconds`.

### D3. The panel is per-rack, not per-server

Clicking a rack opens a panel showing **all** of that rack's servers with their free/used
trait bars. Accepted-but-unplaced jobs sit in a tray along the panel's edge.

This is what makes "move a workload to another server" a single drag. A per-server panel would
need a held/clipboard state to move anything across servers — worse for the action the player
performs most.

### D4. The player must walk to the rack; the panel opens immediately; viewing is always free

Dispatch is gated on physical presence: the player must be standing at the rack for a drop to
commit. **But the panel opens the instant you click the rack**, showing live state, and the
player starts walking automatically. Drops made while walking are held as *pending intent* and
commit on arrival, in drop order.

Crucially, **opening a panel and walking to interact with it are two separate things.** Any
rack's panel can be opened purely to look — what workloads are on it, how much free capacity
each server has left — with zero travel required and zero commitment to go there. That look is
read-only: while the player is not physically at the rack, the panel shows state but does not
accept drags. Dragging a tray card onto a server, or a placed chip between servers, only
starts once the player is standing at that rack; until then those interactions are simply not
offered (no drop preview, no pending-intent queue) rather than accepted-and-deferred. In other
words, *inspecting* a rack is remote; *changing what's on it* is not — only clicking a rack you
mean to dispatch at should trigger the walk-there flow at all, since opening a panel is now
also the ordinary way to check on a rack in passing.

> **Trade-off, called out explicitly.** Walking is still on the critical path of every
> placement or move. That is friction on the core loop, and it is the first thing to revisit if
> dispatch feels sluggish in playtest. Free remote viewing is a partial mitigation — the player
> can always plan a route by checking racks ahead of time — but it does not remove the walk
> itself. If it still drags in playtest, the escape hatch is a cheap facility upgrade ("remote
> management console") that lifts the presence requirement for drags too — a progression
> unlock rather than a redesign.

### D5. Traits are a fixed named set, not an open map

`CPU`, `RAM`, `Storage` today; bandwidth and others later. Modeled as a `ServerTraits`
interface with named numeric fields, **not** `Record<string, number>`.

Named fields give compile-time errors when a new trait is added and a fit-check or a panel
forgets it. An open map defers that to runtime. Adding a trait later means touching one
interface and letting `tsc` list every site that needs updating — which is exactly the tooling
leverage `CLAUDE.md` asks TypeScript to provide.

### D6. Servers come from a fixed catalog of predefined tiers — no custom builds

The player buys from a fixed set of named server tiers (five to start — see the tier table
below); there is no build-your-own-server screen where the player picks a CPU/RAM/Storage combo
directly. This is already how `MachineTierDef` works today (`game-data.ts`, currently `basic`
and `dense`) and this plan keeps that shape — traits are just added fields on the same fixed
tier definitions, not a new axis of player-chosen configuration.

The tier catalog is expected to keep growing over time, but each new tier is a hand-authored row
the designer adds to `MACHINE_TIERS`, the same way `basic` and `dense` exist today — not a
configuration the player assembles at purchase time. Custom server builds are explicitly out of
scope for this plan.

---

## Data model changes

### `game-data.ts`

**New: the trait vector.**

```ts
export interface Traits {
  cpu: number;      // cores
  ramGb: number;
  storageGb: number;
}

export const TRAIT_KEYS = ['cpu', 'ramGb', 'storageGb'] as const;
export type TraitKey = (typeof TRAIT_KEYS)[number];

export const TRAIT_LABELS: Record<TraitKey, string> = {
  cpu: 'CPU',
  ramGb: 'RAM',
  storageGb: 'SSD',
};

export const TRAIT_UNITS: Record<TraitKey, string> = {
  cpu: 'c',
  ramGb: 'GB',
  storageGb: 'GB',
};
```

`TRAIT_KEYS` is the single place a new trait gets registered. Every fit-check, subtraction, and
panel bar iterates it, so adding `bandwidthMbps` later is a one-line change plus whatever `tsc`
flags on the `Traits` interface.

**Changed: machine tiers carry traits instead of `compute`.**

```ts
export interface MachineTierDef {
  id: MachineTierId;
  label: string;
  cost: number;
  traits: Traits;        // replaces `compute: number`
  powerKw: number;
  coolingKw: number;
  installSeconds: number;
}
```

Starting numbers (tune in playtest; the shapes matter more than the values). Five tiers, each
deliberately lopsided toward a different trait, so the catalog itself teaches the player that
server choice is a decision, not just "buy the bigger number":

```ts
export type MachineTierId = 'basic' | 'dense' | 'storage' | 'memory' | 'budget';
```

| tier | cost | CPU | RAM | Storage | power | cooling | install | character |
|---|---|---|---|---|---|---|---|---|
| `budget`  | 120 | 4  | 8   | 250  | 0.2 | 0.15 | 2.0 | cheap, weak on everything — early filler |
| `basic`   | 250 | 8  | 32  | 1000 | 0.4 | 0.3  | 3.0 | balanced all-rounder |
| `dense`   | 900 | 32 | 128 | 2000 | 1.6 | 1.4  | 4.5 | CPU/RAM-heavy, storage lags behind |
| `storage` | 500 | 6  | 24  | 6000 | 0.5 | 0.4  | 4.0 | cheap CPU/RAM, huge disk |
| `memory`  | 700 | 12 | 256 | 800  | 0.9 | 0.8  | 4.0 | RAM-dominant, thin on everything else |

None of these is proportional to another — `dense` is 4x `basic`'s CPU/RAM but only 2x its
storage; `storage` beats `dense` on disk at half the cost but a fifth of the CPU; `memory` has
more RAM than `dense` for less money but a third of the CPU. That is what makes server choice a
decision: a storage-heavy workload mix (the `render` archetype below) wants `storage` boxes, a
RAM-hungry mix (`training`) wants `memory` boxes, and neither is served well by stacking more
`dense`. See D6 — this is still a fixed, hand-authored catalog (`MACHINE_TIERS` in
`game-data.ts`), not a build-your-own-server screen; adding a sixth tier later means adding one
more row here, in the same shape as these five.

`budget` exists specifically to give a cheap, always-affordable option that unlocks the loop
before the player has capital — it should never be the *best* choice for any archetype, only
the earliest-available one.

**`BUILDABLES` grows from two machine entries to five.** `components.ts` today hardcodes
`machine-basic` and `machine-dense` as the only two `BuildableId`s with `placement: 'rack'`.
Generalize instead of hand-listing each one:

```ts
export type BuildableId =
  | 'rack'
  | `machine-${MachineTierId}`
  | 'power-upgrade'
  | 'cooling-upgrade';

// Replaces the five hand-written machine rows:
const machineBuildables: BuildableDef[] = Object.values(MACHINE_TIERS).map((tier) => ({
  id: `machine-${tier.id}` as BuildableId,
  label: tier.label,
  cost: tier.cost,
  placement: 'rack',
}));
```

This keeps the build panel, its number-key hotkeys (`input.ts`'s `BUILDABLES.forEach` loop),
and `tryInstallIntoRack`'s tier lookup all working unmodified — they already iterate
`BUILDABLES` and parse `MachineTierId` generically. Adding a sixth tier to `MACHINE_TIERS`
is then enough to add its buildable, hotkey, and panel entry with no further code changes,
which is the same "one row, `tsc` catches the rest" leverage as D6 intends. With five machine
entries plus `rack`/`power-upgrade`/`cooling-upgrade`, the build panel has 8 rows — check that
`getBuildPanelEntryRect`'s stacked layout still fits the canvas height at this count before
step 1 lands; shrink `BUILD_PANEL_ENTRY_HEIGHT`/`GAP` slightly if not.

**Changed: workload archetypes carry trait demands and a deadline.**

```ts
export interface WorkloadArchetypeDef {
  id: WorkloadArchetypeId;
  label: string;
  demands: Traits;            // replaces `computeRequired`
  workSeconds: number;        // replaces `durationSeconds` — time ON a server to finish
  deadlineSeconds: number;    // replaces `graceSeconds` — total wall-clock from acceptance
  payPerSecond: number;
  coolingBonusKw: number;
  minReputation: number;
  scales: boolean;
  offerSeconds: number;       // NEW — how long the offer sits before auto-declining
}
```

`deadlineSeconds` must exceed `workSeconds` by enough to walk across the floor — budget
roughly `workSeconds + 30` for early archetypes, tightening to `workSeconds + 15` for the
late ones so that late-game dispatch has to be efficient.

Shape the archetypes so they stress *different* traits — this is the whole reason traits
exist:

| archetype | CPU | RAM | Storage | work | deadline | character |
|---|---|---|---|---|---|---|
| `web`      | 2  | 8   | 100  | 45 | 80  | small, balanced, always available |
| `batch`    | 8  | 16  | 200  | 30 | 60  | CPU-leaning |
| `render`   | 16 | 32  | 800  | 40 | 70  | storage-heavy |
| `training` | 24 | 96  | 400  | 60 | 85  | RAM-hungry, the squeeze |

**Changed: `getComputeScale` → `getDemandScale`**, and `DemandClock.peakComputeServed` →
`peakCpuServed` (CPU is the proxy for demonstrated capacity). Scaling multiplies every trait
in `demands` and `payPerSecond` alike, so the shape of an archetype is preserved as it grows.

**New constants:**

```ts
export const REPUTATION_ON_MISSED_DEADLINE = -8;   // renamed from REPUTATION_ON_EXPIRY
export const REPUTATION_ON_COMPLETION = 3;
export const REPUTATION_ON_DECLINE = 0;            // declining is free — see D-note below
export const MAX_OFFERS = 3;                       // concurrent offers on screen
```

> **Why declining is free.** If declining cost reputation, the accept gate would be a false
> choice — you would accept everything and eat the miss penalty instead, which is the current
> game. Free declines make "am I able to serve this?" the actual question. The cost of
> declining is opportunity cost: no money, and the demand clock does not slow down.

### `components.ts`

**New components:**

```ts
// Servers (formerly "machines") — mutable free capacity, derived from tier minus placements.
// Recomputed by the capacity system each tick; never hand-edited.
export interface ServerCapacity {
  total: Traits;
  free: Traits;
}

// An offered contract awaiting accept/decline. Its own entity; no Position, no Renderable.
export interface Offer {
  archetypeId: WorkloadArchetypeId;
  demands: Traits;
  workSeconds: number;
  deadlineSeconds: number;
  payPerSecond: number;
  secondsRemaining: number;   // offer auto-declines at 0
}

// Placement of a workload onto a server. Lives on the WORKLOAD entity (one server per
// workload — see D1), which is the inverse of today's `Assignment` on the machine.
export interface PlacedOn {
  serverId: EntityId;
}

// Which rack's panel is open. Attached to the player. A panel can be opened purely to view
// (`mode: 'viewing'`, no travel) or opened to dispatch (`mode: 'dispatching'`, which kicks off
// a walk to the rack). See D4 — only 'dispatching' ever accepts drags.
export interface OpenRackPanel {
  rackId: EntityId;
  mode: 'viewing' | 'dispatching';
  arrived: boolean;          // dispatching only; false while walking, drops held until true
}

// A drop the player made while still walking — committed on arrival, in order.
export interface PendingDrop {
  workloadId: EntityId;
  serverId: EntityId;
}

// Transient drag state. Attached to the player; exists only between mousedown and mouseup.
export interface DragState {
  workloadId: EntityId;
  pointer: { x: number; y: number };
  origin: 'tray' | { serverId: EntityId };   // where it came from, for cancel/revert
}
```

**Changed `Workload`:**

```ts
export type WorkloadState = 'accepted' | 'running';

export interface Workload {
  archetypeId: WorkloadArchetypeId;
  demands: Traits;
  workSeconds: number;
  workRemainingSeconds: number;      // only decrements while state === 'running'
  deadlineRemainingSeconds: number;  // decrements ALWAYS, from acceptance
  payPerSecond: number;
}
```

`state` is derivable from `PlacedOn` presence, but keeping it explicit avoids every system
doing a component lookup to answer "is this running". Keep both in sync in exactly one place
(the place/unplace helpers in `src/ecs/dispatch.ts`, below).

**Deleted:** `Assignment` / `assignments` (replaced by `PlacedOn` on the workload).

**Changed `Utilization`:** `computeTotal`/`computeFree` become `traitsTotal`/`traitsFree` of
type `Traits`, plus per-rack rollups for D-requirement "each rack shows power and heat":

```ts
export interface Utilization {
  powerDrawKw: number;
  coolingDrawKw: number;
  traitsTotal: Traits;
  traitsFree: Traits;
}

// Per-rack, recomputed each tick. Lives on the RACK entity.
export interface RackLoad {
  powerKw: number;
  heatKw: number;
  serverCount: number;
}
```

---

## New module: `src/ecs/traits.ts`

Pure trait arithmetic, no ECS dependency, no side effects. **Every** system that touches traits
goes through this — no ad-hoc `a.cpu - b.cpu` anywhere else. Iterating `TRAIT_KEYS` here is
what makes a future trait a one-line addition.

```ts
export function zeroTraits(): Traits;
export function addTraits(a: Traits, b: Traits): Traits;
export function subtractTraits(a: Traits, b: Traits): Traits;
export function scaleTraits(t: Traits, factor: number): Traits;   // rounds
export function fits(demands: Traits, free: Traits): boolean;     // every key: demands <= free
export function shortfall(demands: Traits, free: Traits): TraitKey[];  // which keys block it
```

`shortfall` is what the panel uses to tell the player *why* a drop was rejected ("needs 8 CPU,
4 free") rather than just refusing silently. That feedback is the difference between a fit rule
that teaches and one that frustrates.

---

## New module: `src/ecs/dispatch.ts`

The only place workload placement mutates. Systems and input both call into it, so the
`state` / `PlacedOn` / `ServerCapacity.free` invariant lives in one file.

```ts
// Validity check, no mutation. Returns null if OK, or the blocking trait keys.
export function checkPlacement(
  world: World, workloadId: EntityId, serverId: EntityId,
): TraitKey[] | null;

// Place (or move). Asserts checkPlacement passed. Unplaces from the previous server first.
export function placeWorkload(world: World, workloadId: EntityId, serverId: EntityId): boolean;

// Remove from its server; workload returns to the tray as 'accepted'.
export function unplaceWorkload(world: World, workloadId: EntityId): void;

export function acceptOffer(world: World, offerId: EntityId): EntityId;  // -> workload entity
export function declineOffer(world: World, offerId: EntityId): void;
```

`checkPlacement` must also reject placement on an **offline** server (`Powered.online === false`)
— a browned-out box cannot take work.

---

## Systems

### Changed: `src/ecs/systems/workload-spawn.ts` → offers, not workloads

Spawns `Offer` entities (capped at `MAX_OFFERS` concurrent) instead of workloads. Ticks each
offer's `secondsRemaining`; at zero the offer is destroyed with **no** reputation penalty — an
ignored offer is a silent decline.

The arrival interval still comes from `getArrivalInterval(elapsed, reputation)`. When offers
are at cap, the clock keeps running but spawning is suppressed — so a player who ignores
everything does not accumulate a backlog.

### Deleted: `src/ecs/systems/workload-assign.ts`

Including `selectMachinesForWorkload`. Its job is now the player's. (See D1 — this is the
central reversal of `.plans/workload-economy.md`.)

### New: `src/ecs/systems/capacity.ts`

Recomputes, every tick, from scratch (same derived-cache discipline as the current
`resource.ts`):

- each server's `ServerCapacity.free` = tier traits minus the demands of every workload whose
  `PlacedOn.serverId` points at it
- each rack's `RackLoad` (power, heat, server count) — this is what the rack label renders
- the facility's `Utilization.traitsTotal` / `traitsFree`

Offline servers contribute **zero** to `traitsTotal`/`traitsFree` but still report their own
`total` for the panel (so the player sees "this box is dark", not "this box vanished").

Runs **after** `resource.ts` (which decides who is online) and **before** `workload-run.ts`.

### Changed: `src/ecs/systems/resource.ts`

- `drawFor` keeps its shape; `coolingBonusKw` now applies per *workload placed on* the server
  (summed across its placements), not per assigned machine.
- `unassign()` on brownout becomes `unplaceWorkload()` for every workload on that server — they
  return to the tray still holding their deadline. Losing a server to a brownout mid-run is now
  a **visible, recoverable** setback rather than silent progress loss: the jobs come back to the
  tray and the player can re-place them elsewhere if they have room.
- Heat: for now `heatKw === coolingKw` draw. Keep them as separate fields on `RackLoad` anyway,
  so a later change (heat accumulating locally per rack, hot spots) does not need a data-model
  change.

### Changed: `src/ecs/systems/workload-run.ts`

Per workload, every tick:

1. `deadlineRemainingSeconds -= dt` **always**.
2. If placed and its server is online: `workRemainingSeconds -= dt`, and pay
   `payPerSecond * dt`.
3. `workRemainingSeconds <= 0` → complete: `+REPUTATION_ON_COMPLETION`, bump
   `contractsServed` / `peakCpuServed`, unplace, destroy.
4. `deadlineRemainingSeconds <= 0` → miss: `REPUTATION_ON_MISSED_DEADLINE`, unplace, destroy.

Order matters: check completion before deadline, so a job finishing on the same tick its
deadline expires counts as a success.

### New: `src/ecs/systems/rack-panel.ts`

Owns panel open/close and drag-and-drop, reading `InputState` and writing `OpenRackPanel` /
`DragState` / `PendingDrop`. Runs in the **update** list (it mutates), before `capacity.ts`.

Two distinct ways to open a panel (see D4):

- **View a rack** — a lightweight "inspect" click (e.g. right-click, or a small ⓘ hit rect on
  the rack sprite; exact affordance is a step-7 detail) → `OpenRackPanel { rackId,
  mode: 'viewing', arrived: false }`. No movement, no `moveControlledTo` call. The panel draws
  every server's trait bars and placed-workload chips exactly as in dispatching mode, but the
  tray and every server row render **non-interactive** — no drag starts from a `mousedown` in
  this mode. Useful for planning a route or checking a rack in passing without committing to
  walk there.
- **Dispatch at a rack** — the ordinary left-click → `OpenRackPanel { rackId,
  mode: 'dispatching', arrived: false }`, and the player paths to it via the existing
  `moveControlledTo`. On arrival (player's grid cell adjacent to the rack) → `arrived = true`,
  and every `PendingDrop` is committed in order via `placeWorkload`, skipping any that no
  longer fit.
- Switching from a viewing panel to dispatching the same rack (e.g. the player left-clicks a
  rack they already have open for viewing) simply flips `mode` to `'dispatching'` and starts
  the walk — the panel stays open throughout, it does not need to close and reopen.
- Drag (dispatching mode only, and only once `mode === 'dispatching'`): mousedown on a tray
  card or a placed-workload chip starts `DragState`; mouseup over a server row calls
  `checkPlacement`. Fits → commit (or queue as `PendingDrop` if not yet arrived). Doesn't fit →
  reject, flash the blocking trait bars red, card returns to origin. In viewing mode this whole
  branch is skipped — a `mousedown` over a tray card just does nothing.
- `Escape` or clicking outside closes the panel and drops any pending intent (dispatching mode
  only — a viewing-mode panel never has pending intent to drop).

### Changed: `src/ecs/systems/hud.ts`

The workload panel becomes the **offers panel**: up to `MAX_OFFERS` cards, each showing
archetype label, the three trait demands, pay/sec, total value, and the offer countdown, with
`[Accept]` / `[Decline]` hit rects. An offer whose demands exceed every online server's free
capacity is drawn dimmed with a "no server fits this" note — informative, still acceptable
(the player may be about to install a bigger box).

Top bar: `▦ compute` is replaced by three compact trait meters (`CPU 12/40`, `RAM 48/160`,
`SSD 1.2/4.0T`) plus a tray count badge (`◷ 2 queued`) and the nearest deadline
(`⚠ 0:14`).

### Changed: `src/ecs/systems/render.ts`

- **Rack labels** (the explicit requirement): under each rack, two small lines — `⚡ 2.4 kW`
  and `🔥 1.8 kW` — read straight off `RackLoad`. Colored against facility headroom so an
  over-drawing rack is visible from across the floor without opening anything.
- Rack slot LEDs: `empty` / `offline` / `idle` / `partial` / `full`, where partial vs. full
  comes from whether *any* trait in `ServerCapacity.free` has hit zero.
- Draws the rack panel itself and the dragged card (panel drawing lives in render; hit-testing
  and state live in `rack-panel.ts` and `ui/layout.ts` — same split as the existing build panel).

### Changed: `src/ui/layout.ts`

Add pure rect functions, matching the existing `getBuildPanelEntryRect` style so everything
stays hit-testable without a canvas:

```ts
getRackPanelRect(canvasW, canvasH, serverCount): Rect;
getServerRowRect(index, ...): Rect;
getServerTraitBarRect(index, traitIndex, ...): Rect;
getPlacedChipRect(serverIndex, chipIndex, ...): Rect;
getTrayCardRect(index, ...): Rect;
getOfferCardRect(index, canvasW): Rect;
getOfferButtonRect(index, 'accept' | 'decline', canvasW): Rect;
```

`pointerInHud` must also return true for the open rack panel, so a click inside it never falls
through to "walk here".

### Changed: `src/input/index.ts`

Drag needs press/release, which the current click-only input cannot express. Add:

```ts
wasPressed(): boolean;       // mousedown edge this frame
wasReleased(): boolean;      // mouseup edge this frame
isPointerDown(): boolean;
```

Keep `wasClicked()` — the build panel and movement still want click semantics. This is an
additive change; nothing existing breaks.

---

## System order in `main.ts`

The current ordering comment is load-bearing; here is the replacement, with reasons:

```
input              — movement, build panel, rack open/close
rack-panel         — drag/drop; commits pending drops on arrival (before capacity reads them)
install-progress   — before movement (detects arrival on last frame's position)
path-follow
movement
resource           — decides Powered.online; unplaces workloads off browned-out servers
capacity           — AFTER resource (needs online state), BEFORE run and hud
workload-spawn     — offers
workload-run       — pays, completes, misses deadlines
```

`capacity` must sit between `resource` and `workload-run` for the same reason `resource` sits
before the workload systems today: running `workload-run` against stale free-capacity would pay
out for placements that a brownout already invalidated this frame.

---

## Implementation steps

Each step should leave the game runnable. Do not start the next until the previous one is
validated manually.

1. **Traits foundation.** Add `Traits`, `TRAIT_KEYS`, `src/ecs/traits.ts`. Convert
   `MachineTierDef.compute` → `traits` and `WorkloadArchetypeDef.computeRequired` → `demands`,
   keeping just the existing `basic`/`dense` pair for now. Let `tsc` list every break; fix them
   with the *old* auto-assign behavior intact (treat `traits.cpu` as the old scalar). **Game
   still plays identically.** Generalize `BUILDABLES` to derive from `MACHINE_TIERS` (see
   above) in this step too, since it's a mechanical change and unblocks step 1a.
   1a. **Expand the tier catalog.** Add `storage`, `memory`, `budget` to `MACHINE_TIERS` per
       the table above. Because `BUILDABLES` now derives from `MACHINE_TIERS`, this alone adds
       three new build-panel entries and hotkeys — no other code changes. Good checkpoint to
       verify the build panel still fits the canvas at 8 rows.
2. **Capacity system + rack labels.** Add `ServerCapacity`, `RackLoad`, `capacity.ts`. Render
   the per-rack power/heat labels and trait-based slot LEDs. Still auto-assigning. The visible
   deliverable is the rack labels.
3. **Placement model.** Add `PlacedOn` and `src/ecs/dispatch.ts`; delete `Assignment`. Rewrite
   `workload-assign.ts` as a temporary one-workload-one-server auto-placer using
   `checkPlacement`, so the game keeps running while the UI does not exist yet. Update
   `resource.ts`'s brownout path to `unplaceWorkload`.
4. **Deadlines.** Collapse `graceRemainingSeconds`/`elapsedSeconds`/`durationSeconds` into
   `deadlineRemainingSeconds`/`workRemainingSeconds`. Update `workload-run.ts` and the HUD
   countdowns.
5. **Offers.** Add the `Offer` component, rework `workload-spawn.ts` to emit offers, add the
   offers panel with accept/decline hit rects. Accepting still hands off to the temporary
   auto-placer. **Now the accept gate is playable** — this is the first step that changes how
   the game feels.
6. **Input press/release.** Extend `InputState`. No behavior change.
7. **Rack panel, read-only.** Both open paths land here: a dispatching click still walks the
   player there first; a viewing click opens immediately with no travel. Either way the panel
   draws servers, trait bars, placed-workload chips, and the tray. No dragging yet in either
   mode. Validates all the layout rects and the viewing/dispatching mode split before drag
   logic is layered on top.
8. **Drag and drop.** `DragState`, `PendingDrop`, drop validation with `shortfall` feedback,
   commit-on-arrival. **Delete `workload-assign.ts` and the temporary auto-placer.** This is
   the step where the game becomes the new game.
9. **Tune.** Archetype trait shapes, tier trait shapes, deadline slack, `MAX_OFFERS`, arrival
   interval. Expect this to take as long as steps 1-8; the numbers in this document are a
   starting point, not a design.

---

## Risks

- **Step 8 is the only irreversible one.** Everything before it keeps a working auto-placer as
  a fallback. If manual dispatch does not feel good, the cheapest retreat is to keep the rack
  panel as an *override* (auto-place by default, drag to rearrange) rather than deleting
  auto-placement outright. Worth keeping in mind while building step 8.
- **Walking friction** (D4) — mitigated, not eliminated. Re-evaluate after step 8.
- **Three traits may be one too many to read at a glance** in a rack panel with six servers.
  If the panel feels noisy at step 7, cut Storage from the panel bars (keep it in the fit check
  and the tooltip) before adding a fourth trait.
- **`checkPlacement` called per-frame during a drag** across every server in a rack is trivial
  at this scale (≤6 servers), but do not let it creep into a per-frame scan of *all* servers on
  the floor.
