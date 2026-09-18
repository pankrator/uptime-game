# Design review: code smells, readability, structure

## Goal

A standing inventory of design debt in `src/`, ordered by value-per-unit-risk, so the next
person touching a tangled file knows whether they are working around a known problem or
discovering a new one.

This is a **review**, not a feature plan. Nothing here changes what the game does. Every item
is scoped so it can be taken alone; none is a prerequisite for a gameplay plan in
[README.md](README.md)'s Proposed table.

Findings are numbered `F1`, `F2`, … and cited from the steps below, same convention the
feature plans use for `D1`, `D2`.

## Baseline (measured, not assumed)

Run on a clean checkout of `main` (`864292d`):

| Check | Result |
| --- | --- |
| `npx eslint .` | clean |
| `npx tsc --noEmit` | clean |
| `npx tsc --noEmit --strict` | **clean** — 0 errors across 67 files |
| `npx vitest run` | **2 failed**, 129 passed (16 files) |

Two of those four lines are findings in their own right — see F1 and F2.

---

## Tier 0 — the test suite is red

### F1. Two tests have been failing since the idle-power change

```
capacity.test.ts > rolls up rack power/heat/server-count from its online installed machines
  expected 0.7 to be close to 2

resource.test.ts > takes the newest online machine offline when draw exceeds capacity
  expected true to be false
```

Both have the same root cause, and neither is a product bug — they are **stale assertions left
behind by `IDLE_POWER_FRACTION`** (`.plans/playtest-findings.md` F5, `game-data.ts`). Since that
change, `resource.ts`'s `drawFor` bills an online machine with nothing placed on it at 0.35× its
tier draw:

- `capacity.test.ts` spawns two servers with no workloads and asserts the full-draw rollup
  (`basic.powerKw + dense.powerKw` = 2.0). It now gets 0.7 — exactly `2.0 × 0.35`.
- `resource.test.ts` sets capacity to `dense.powerKw * 1.5` = 2.4 kW on the comment's reasoning
  that "room for exactly one dense server's power draw (1.6kW), not two (3.2kW)." Only one of
  the two servers has a workload placed, so real draw is now `1.6 + (1.6 × 0.35)` = 2.16 kW,
  which fits. No brownout fires, so nothing goes offline.

Fix is to update the assertions (and the arithmetic in that comment) to the idle-discounted
figures, keeping both tests' actual intent: the rollup test should place a workload on one
server so it covers both the idle and busy paths in one case, and the brownout test should
size capacity against the post-F5 draw so it still forces exactly one machine offline.

**This is Tier 0 for one reason:** every other item below is a refactor, and a refactor against
a red suite cannot tell "I broke this" from "this was already broken." Nothing else in this
document should be started first.

---

## Tier 1 — cheap, verified, no design argument required

### F2. `strict` is off in `tsconfig.json`, and the code already satisfies it

`tsconfig.json` sets `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` — but
never `"strict": true`. So `strictNullChecks` is off, which means the thing the ECS API is built
around is not actually checked:

```ts
getComponent<T>(store: ComponentStore<T>, id: EntityId): T | undefined;
```

Every `if (!position) return;` guard and every `world.getComponent(machines, id)!` in the
codebase is currently a **convention the compiler is not enforcing**. Drop one guard and nothing
complains until it crashes at runtime.

The measured result above is the whole argument: `tsc --noEmit --strict` reports **zero errors**.
The discipline is already there in the source; it just isn't load-bearing. Adding one line makes
it so, with no code changes and no risk.

```jsonc
"strict": true,   // and delete noFallthroughCasesInSwitch — strict does not cover it, keep it
```

Do this immediately after F1.

### F3. `Utilization.computeTotal` / `computeFree` are computed every tick and read by nobody

`components.ts` says it plainly:

> Step 2: added alongside computeTotal/computeFree, filled by capacity.ts. Step 3/4 removes the
> compute-only pair once capacity.ts is the sole source of facility-wide free capacity.

Step 3/4 never happened. Today:

- `resource.ts:189-226` accumulates both fields, including a `workloadsOn(world, id)` scan and
  a `reduce` over its results, per online machine, per tick.
- `capacity.ts` computes the superset (`traitsTotal` / `traitsFree`, which includes `.cpu`).
- Readers of `computeTotal` / `computeFree`: **none** — only the two writes in `resource.ts`
  and the zero-init in `entities.ts`'s `defaultUtilization`.

Delete the two fields, their accumulation in `resource.ts`, and their `defaultUtilization`
entries. That also deletes one of `resource.ts`'s two per-machine workload scans as a side
effect. `save/registry.ts` needs no change — `utilizations` is already `TRANSIENT`.

### F4. `findLowestFreeSlot` is duplicated verbatim

Byte-identical bodies in `src/ecs/systems/input.ts:103` and `src/ecs/systems/maintenance.ts:30`.
A direct hit against CLAUDE.md's "Reuse first." `maintenance.ts` additionally inlines the same
`occupied` set-building a third time in its install branch.

Hoist one copy. The natural home is `maintenance.ts` (it owns the install lifecycle) — but see
F7, which moves `input.ts`'s caller there anyway and makes the export unnecessary.

### F5. The HUD top bar's overflow guard is applied inconsistently

`hud.ts:154` sets up the invariant and states it explicitly:

> Items are listed most- to least-important; each is skipped once x reaches this budget, and
> since skipping leaves x unmoved, every item after the first skip is skipped too.

Three items do not check it:

- the net-income rate (`hud.ts:169`) — low risk, it is second in the bar;
- the overheat alert (`hud.ts:280`) and the failed-machine alert (`hud.ts:296`) — **these sit
  after the per-trait loop**, which is where `x` actually runs out on a narrow canvas.

So on a small window the two alerts draw over the mute button, which the whole `rightLimit`
mechanism exists to protect. Separately, the guard tests only an item's *start* position, so any
item whose text plus 36px bar straddles the limit still overruns it.

Fix: give the bar a single `tryDraw(width, fn)` helper that checks `x + width <= rightLimit`
before drawing and advances `x` only on success, and route all items through it. That removes
eleven hand-written `if (x < rightLimit)` checks and makes it impossible to add a twelfth item
that forgets one.

---

## Tier 2 — structural

These are the ones worth arguing about. Each states the trade-off; none is obviously correct.

### F6. "Which modal is open" has no owner

The rule is "exactly one of {rack panel, shop, offers, jobs} is visible at a time." It is
currently enforced by five modules calling into each other:

| Module | What it knows about modal policy |
| --- | --- |
| `input.ts` | the click-priority chain — offers → jobs → maintenance → rack → shop → build |
| `render.ts` | the draw-priority chain — rack → shop → build (a second, separately-maintained copy) |
| `rack-panel.ts` | calls `closeJobPanels` on open (twice: left-click and right-click) |
| `shop.ts` | calls `closeJobPanels` on proximity open |
| `job-panels.ts` | calls `closeRackPanel` + `dismissShop` via its own `closeOtherModals` |

That produces **two genuine import cycles**:

```
rack-panel.ts → job-panels.ts → rack-panel.ts
shop.ts       → job-panels.ts → shop.ts
```

ESM tolerates them today only because nothing is used at module-evaluation time. They are the
symptom, not the disease: the disease is that a mutual-exclusion invariant is maintained by
every participant remembering to notify every other participant. Adding a sixth panel means
finding all five sites, and the two priority chains (`input.ts` and `render.ts`) can silently
disagree about which panel wins.

**Proposal — `src/ecs/modal.ts`**, a small ECS-free-ish module owning the policy:

```ts
export type ModalKind = 'rack' | 'shop' | 'offers' | 'jobs';

// Single source of priority. Both the click chain and the draw chain read this.
export function activeModal(world: World, player: EntityId): ModalKind | null;
export function openModal(world: World, player: EntityId, kind: ModalKind): void; // closes others
export function closeModal(world: World, player: EntityId, kind?: ModalKind): void;
```

`openModal` does the close-everything-else bookkeeping in one place; each panel module keeps its
own per-panel close (freeing its scroll/drag/confirm components) and registers it here. Both
cycles disappear — `rack-panel.ts`, `shop.ts` and `job-panels.ts` all depend on `modal.ts` and
none on each other. `input.ts` and `render.ts` each replace a hand-ordered `if` chain with one
`switch (activeModal(...))`, so they cannot drift.

**Trade-off:** this adds a module and one level of indirection to a rule that four modules
currently implement correctly. The case for it is not today's behavior — it is that the
duplicated priority chain in `render.ts` is already a second definition of the same rule, and
that visible-vs-clickable disagreements are exactly the class of bug
`.plans/playtest-findings.md` F6/B1 already cost a session each.

### F7. `input.ts` is doing four jobs, two of which are not input

641 lines. The gesture-arbitration part is genuinely well-argued (the drag/click comment at
`input.ts:262-288` explains why one module must own both `wasClicked` and `wasReleased`, and it
is right). The other three parts are not:

1. **Gesture arbitration** — legitimately belongs here.
2. **Panel hit-testing** — ~150 lines walking rack-panel server rows, repair/decommission
   buttons, tray drop buttons, shop tabs, shop buy buttons. `input.ts` imports nine layout
   getters to do it, so it knows the internal geometry of two panels it does not own.
3. **Gameplay mutation** — `tryInstallIntoRack` takes inventory, `tryStartRepair` debits the
   wallet and computes the wear-scaled fee, `tryStartDecommission` and `cancelMaintenanceTask`
   refund it. These create and destroy `MaintenanceTask` — the component `maintenance.ts` owns.
4. **Build-mode placement** — validates room bounds, occupancy, and spawns racks/CRACs.

(3) is the real problem: the maintenance lifecycle is split across two files with the "debit up
front, apply on completion" contract documented in both, and neither file owns it. The repair
cost is computed in `input.ts` and *commented about* in `maintenance.ts`.

**Proposal:** the existing `job-panels.ts` split is already the right pattern — it exports
`handleOffersModalClick(world, renderer, player, facility, pointer, audio)` and `input.ts` calls
it as one line. Extend that pattern rather than inventing a new one:

- move (3) into `maintenance.ts` as `startInstall` / `startRepair` / `startDecommission` /
  `cancelMaintenanceTask` — the module that finishes these tasks becomes the module that starts
  them, and F4's duplicate disappears rather than being hoisted;
- move (2) into each panel's own module as `handleRackPanelClick` / `handleShopClick`, so the
  layout getters stay with the code that draws against them;
- leave (1) and (4) in `input.ts`, which then reads as a ~200-line priority chain of one-line
  delegations.

**Trade-off:** more files, and the click chain's ordering stays load-bearing wherever it lives —
this does not make the ordering go away, it makes each branch one line so the ordering is
readable at a glance. Do F6 first: the chain becomes a `switch` on `activeModal`, and these
handlers become its cases.

### F8. The layout data clump

`ui/layout.ts` threads `(canvasWidth, canvasHeight, serverCount, trayCount)` through 12 exported
rack-panel functions; the shop's equivalent adds `rowCount`, the jobs modal's adds
`contentHeight`. 35 parameter declarations, ~40 call sites. Call sites look like this:

```ts
const barRect = getServerTraitBarRect(index, traitIndex, canvasWidth, canvasHeight,
                                      serverIds.length, trayIds.length);
```

Worse, the getters are a recomputation cascade: `getServerTraitBarRect` → `getServerRowRect` →
`getRackPanelRect` → `getTrayHeight` → `getTrayColumns`. Drawing one server row evaluates
`getRackPanelRect` seven-plus times (row, four bars, two buttons, one per chip), all with
identical arguments and identical results.

**Proposal:** one entry point returning a computed layout, consumed by draw and hit-test alike:

```ts
export interface RackPanelLayout {
  panel: Rect; content: Rect; contentHeight: number; close: Rect;
  serverRow(i: number): Rect;
  traitBar(i: number, trait: number): Rect;
  repairButton(i: number): Rect;  decommissionButton(i: number): Rect;
  placedChip(i: number, chip: number): Rect;
  trayCard(i: number): Rect;      trayCardDropButton(i: number): Rect;
  trayTopY: number;               trayDrop: Rect;
}
export function rackPanelLayout(canvasWidth: number, canvasHeight: number,
                                serverCount: number, trayCount: number): RackPanelLayout;
```

`drawRackPanel`, `tryStartDrag`, `resolveDrop`, `hitTestServerRow`, `toContentSpace` and
`input.ts`'s button loops each build it once at the top and index into it. The four-value clump
is named once per call site instead of forty times, and the existing `layout.test.ts` cases port
over nearly unchanged.

**Trade-off — be honest about which problem this solves.** It is *not* a performance fix. Even
at a full rack the repeated work is a few thousand cheap arithmetic calls per second, which
matters to nothing. The payoff is that the panel's geometry stops being 12 independent functions
that each re-derive the same panel rect and that must be kept mutually consistent by hand — the
exact drift `RACK_SERVER_ROW_HEIGHT`'s "keep them in sync if this changes" comment is currently
warning about. Apply the same treatment to the shop and jobs modals only if this reads better in
practice; three near-identical layout objects is not obviously better than three sets of getters.

### F9. `Utilization` has three writers — its own comment says that is one too many

From `components.ts`:

> Written by more than one system (resource.ts and workload-run.ts write disjoint fields;
> capacity.ts writes the traits/compute fields) — see .plans/power-billing.md step 3.
> **A third writer means this should be split by owner.**

The third writer arrived. Current split:

| Field | Writer |
| --- | --- |
| `powerDrawKw`, `coolingDrawKw`, `powerCostPerSecond` | `resource.ts` |
| `traitsTotal`, `traitsFree` | `capacity.ts` |
| `revenuePerSecond` | `workload-run.ts` |
| `computeTotal`, `computeFree` | `resource.ts` — **dead, see F3** |

The tripwire the codebase set for itself has fired. Split into `PowerDraw` (resource),
`FacilityCapacity` (capacity) and `Revenue` (workload-run), each with exactly one writer, and
make `hud.ts` read three components instead of one. Do F3 first — deleting the dead pair may be
enough to make the split feel unnecessary for another few features, and that is a legitimate
outcome. Record the decision either way.

**Decision (post-F3): not splitting, for now.** With the dead `computeTotal`/`computeFree` pair
gone, the remaining three writers each own a small, disjoint field set, and every reader that
matters — `hud.ts`'s `drawTopBar`, which is also the only place all six remaining fields are read
together — needs power, capacity and revenue in the same line of the bar. Splitting would touch
10 files (`resource.ts`, `capacity.ts`, `workload-run.ts`, `workload-spawn.ts`, `render.ts`,
`hud.ts`, `entities/index.ts`, `save/registry.ts`, `save/manager.ts`, and both their tests) to
turn one `getComponent` call into three at every read site, for an organizational win with no
bug behind it and no read-side test coverage (`hud.ts`/`render.ts`) to catch a mistake in the
move. Revisit if a fourth writer ever shows up — that would be the tripwire firing a second
time on the same component, which is a different argument than this one.

### F10. The `render.ts` / `hud.ts` boundary is historical, not architectural

`render.ts` is 1555 lines; `drawRackPanel` alone is 390. `hud.ts` is 869.

The split is presented as world-drawing vs HUD, but it is not: `render.ts` draws the rack panel,
the shop panel, the build panel and the pending-deadline border — all screen-space UI, all
outside the camera transform, all after an explicit `camera.resetTransform()`. Meanwhile `hud.ts`
draws the offers and jobs modals, which are the same kind of thing as the rack panel it does not
draw. The real seam runs *through* `render.ts`, not between the two files.

**Proposal:** cut along the seam that already exists in the code.

- `systems/render.ts` — everything inside the camera transform: outdoors, building, corridor,
  heat overlay, racks, CRACs, floating text, player. Ends at `camera.resetTransform`.
- `ui/panels/rack-panel.draw.ts`, `shop.draw.ts`, `build-panel.draw.ts`, `offers.draw.ts`,
  `jobs.draw.ts`, `top-bar.draw.ts`, `tutorial-banner.draw.ts` — one file per panel, each next
  to the module that owns that panel's state and (after F7) its clicks.
- `systems/hud.ts` — the screen-space compositor: decides which panel is up (via F6's
  `activeModal`) and calls into the draw modules in order.

**Trade-off:** this is the largest item here and delivers no behavior. Its value is entirely
downstream — F7's handlers and F8's layout objects both want to live next to the panel they
serve, and a 390-line function is where the "check the docs before extending a system" habit
breaks down. Sequence it after F6-F8 or not at all; doing it *first* just moves code around.

**Decision (post-F6/F7/F8/F11): not doing it now.** F6-F8 are in; F10 is legitimately next in
sequence, not blocked. Not doing it anyway, for a reason specific to this item and not a general
excuse to skip Tier 2 work: `render.ts` (1555 lines) and `hud.ts` (869 lines) are exactly the two
modules `.plans/design-review.md` F16 already flags as having zero test coverage, and CLAUDE.md
rules out the one thing that would substitute for that coverage here — opening the running game
and confirming every panel still draws in the right place after cutting seven files out of two.
Every other step in this plan that touched draw code (F5, F11) either had `layout.test.ts`
underneath it or was a pure constant/helper substitution checkable by inspection; moving 390
lines of `drawRackPanel` and the rest of `render.ts`/`hud.ts` into seven new files is neither —
it is exactly the kind of change a stray copy-paste or a dropped argument could break silently,
with nothing in the suite positioned to catch it. Worth doing once F16's remaining gap (input.ts,
render.ts, hud.ts, job-panels.ts, tutorial.ts) has real coverage, or once someone can drive the
game to confirm it visually; not worth doing blind. `git log` is the record of every other item
in this plan that WAS done — this note is the record for the one that wasn't, and why.

### F11. No shared drawing vocabulary for the canvas

Three symptoms of one gap:

- **Colors.** `#e6e8eb`, `#9aa0a6`, `#3ddc84`, `#f7b731`, `#e5484d` appear 33 times across
  `render.ts` and `hud.ts`, declared three separate times as const blocks
  (`RACK_PANEL_*`, `SHOP_*`, and `hud.ts`'s `TEXT_COLOR`/`DIM_COLOR`/`RED`/`AMBER`/`GREEN`) and
  inlined as literals everywhere else. Retheming means a find-and-replace across two files.
- **Bars.** The "grey track, colored fill, clamp the fraction" pattern is written by hand four
  times: trait bars, the wear bar, the placed-chip progress bar (all `render.ts`), and
  `hud.ts`'s `drawInlineBar` — which is the extracted version of the other three, in the wrong
  file for them to use.
- **Canvas state leakage.** `ctx.font`, `ctx.textAlign` and `ctx.textBaseline` are global and
  are mutated freely across draw functions, with ad-hoc `ctx.textAlign = 'left'` resets at the
  end of some (`drawMuteButton`, `drawRecenterButton`, the decommission button) and not others.
  Whether a function draws correctly depends on what ran before it.

**Proposal — `src/ui/draw.ts`**, a dozen small functions, no framework:

```ts
export const UI = { text: '#e6e8eb', dim: '#9aa0a6', ok: '#3ddc84',
                    warn: '#f7b731', bad: '#e5484d' } as const;

export function text(ctx, s, x, y, o?: { font?, align?, baseline?, color?, maxWidth? }): void;
export function bar(ctx, rect: Rect, fraction: number, color: string): void;
export function box(ctx, rect: Rect, fill?: string, stroke?: string): void;
export function button(ctx, rect: Rect, label: string, style: 'primary'|'danger'|'muted'): void;
```

`text()` sets every text property it uses on each call, so no function inherits state from its
predecessor and no function needs a reset. This is the highest lines-removed-per-risk item in
Tier 2 and it is incremental — convert one panel, confirm it looks identical, convert the next.

**Trade-off:** do not go further than this. A retained-mode scene graph or a canvas UI library
would be solving a problem this project does not have, the same call CLAUDE.md already made
about ECS libraries.

---

## Tier 3 — known, lower priority

### F12. Component stores are module-level singletons, not owned by `World`

`world.ts` documents this at length and honestly: `createWorld()`'s id counter and `entities` set
are the only per-instance state; the `Map`s themselves are created once in `components.ts` and
shared by every `World`. Correctness depends on `resetAllComponentStores()` being wired into
`src/test/setup.ts`.

It is safe today because exactly one `World` exists per page load. But `runGame` *does* call
`createWorld()` per invocation, and the landing screen already exists — a "quit to menu" feature
would hit this immediately, with entity ids restarting at 1 against maps still holding the
previous game's components at those ids. That is a silent data-corruption bug, not a crash.

**Cheapest fix (one line):** have `createWorld()` call `resetAllComponentStores()`. The invariant
becomes true by construction instead of by test-setup convention, and `src/test/setup.ts`'s
global hook becomes redundant.

**Trade-off:** that permanently rules out two live `World`s in one process. Given `world.ts`
already documents that as unsupported, making it enforced rather than merely documented is the
honest move. The alternative — moving stores into `World` behind a token registry — is correct
but costs a touch in every one of the ~50 component call sites and buys a capability nothing
wants.

### F13. The trait list is hardcoded in three places

`traits.ts` opens with:

> Iterating `TRAIT_KEYS` here is what makes a future trait (e.g. bandwidth) a one-line addition
> instead of a hunt through every system.

Three sites would still need hand-editing:

- `traits.ts:8` — `zeroTraits()` returns a literal `{ cpu: 0, ramGb: 0, storageGb: 0 }`, in the
  very module making the claim;
- `dispatch.ts:35` — `checkPlacement`'s offline branch returns a literal
  `['cpu', 'ramGb', 'storageGb']`;
- `render.ts:1462-1470` — `anyTraitExhausted` / `anyTraitUsed` spell out `.cpu`, `.ramGb`,
  `.storageGb` by hand.

All three are one-liners over `TRAIT_KEYS` (`Object.fromEntries(TRAIT_KEYS.map(k => [k, 0]))`,
`[...TRAIT_KEYS]`, `TRAIT_KEYS.some(...)`). Cheap, and it makes the module comment true.

### F14. `Math.random()` is inlined in two spawn paths, injected in a third

`wear.ts` takes the roll as a parameter (`rollFailure(chance, deltaSeconds, Math.random())`),
which is why `wear.test.ts` can cover 17 cases deterministically. `workload-spawn.ts:21`
(archetype weighting) and `entities.ts:181` (`spawnOffer`'s `repeatCount` roll) call
`Math.random()` inline, so neither is testable without stubbing a global — which is why
`workload-spawn.test.ts` has 5 cases and none of them covers which archetype gets picked.

Follow `wear.ts`: take the roll as a parameter, default it to `Math.random()`.

### F15. Module-level mutable UI state in `shop.ts`

`shopTab` and `dismissedWhileInRange` live at module scope, outside the ECS, in a codebase whose
stated architecture is "state lives in components." They survive a `createWorld()`, are absent
from the save format, and are read/written from three modules (`shop.ts`, `input.ts`,
`render.ts`). Same singleton hazard as F12, at a smaller scale.

`shopTab` is a reasonable candidate for a component on the player (the panel is per-player and
already has `ShopOpen`); `dismissedWhileInRange` is genuinely transient and could stay if the
comment says why. Low urgency — flagged so nobody copies the pattern into a sixth panel.

### F16. The untested surface is exactly the tangled surface

131 tests across 16 files, and the coverage is good where the code is clean: `traits`,
`pathfinding`, `wear`, `thermal`, `dispatch`, `game-data`, `capacity`, `resource`,
`workload-run`, `workload-spawn`, the save round-trip, and `ui/layout`.

Zero tests for: `input.ts`, `rack-panel.ts`, `job-panels.ts`, `shop.ts`, `maintenance.ts`,
`tutorial.ts`, `render.ts`, `hud.ts` — the eight largest and most interconnected modules.

That is not an oversight so much as a consequence: each takes a `Renderer` (a live
`HTMLCanvasElement` + 2D context) and reads `performance.now()` directly, so none can run
headlessly. F7 and F8 are what make them testable — a `handleRackPanelClick(layout, pointer)`
taking a plain layout object and a point needs no canvas. Worth stating explicitly so the
testing work is sequenced after the extraction, not attempted before it.

### F17. Listener lifecycle

`createInput` and `createRenderer` register `window` listeners (`keydown`, `pointer*`, `wheel`,
`resize`, `orientationchange`) and never remove them. `InputState.onKeyDown` returns an
unsubscribe function; nothing in the codebase calls one. `createGameLoop` has a proper `stop()`,
so the pattern is understood — it just was not applied to the other two.

Harmless while `runGame` runs once per page load. It becomes a double-fire bug the day a
"quit to menu" ships, alongside F12. Fixing both together is the natural pairing.

---

## Deliberately not proposed

Listing the rejections, per the plan conventions — these are more useful later than the choices.

- **An ECS library, or archetype/bitset storage.** `resource.ts` calls `workloadsOn` per online
  machine per tick, each a full scan of `placedOns`; `capacity.ts` and `rack-panel.ts` each do a
  third variation of the same "workloads on this server" query. That is O(machines × workloads)
  three times a tick. At this game's entity counts (dozens of racks, hundreds of machines at the
  extreme, a handful of workloads) it is free, and CLAUDE.md already ruled on this. *If* the
  three variants get unified for readability, `Map<serverId, EntityId[]>` built once per tick
  falls out for nothing — but do it for the duplication, not the speed.
- **Splitting `game-data.ts`** (507 lines, every domain's tuning constants plus type definitions
  plus derived functions). It reads like a god module but behaves like a tuning file, and one
  place to tune is a feature, not a smell. Revisit only if it passes ~800 lines or if the
  derived functions (`getValueScale`, `getDemandScale`, `computeMaxDemandScale`,
  `clampReputation`, `getArrivalInterval`) grow enough to want their own tested module.
- **"Fixing" `Temperature` and `Condition` into derived caches.** Both are deliberate,
  loudly-documented exceptions — integrated state with history. `components.ts` says "Do not
  'fix' this into a recompute." Correct as-is.
- **Restructuring the `save/` module.** `registry.ts`'s two-list design with an exhaustiveness
  test (`registry.test.ts`) is the best-factored part of the codebase. Leave it alone.
- **Touching the update-order comment block in `main.ts`.** It is 40 lines of dependency
  rationale and it is load-bearing documentation, mirrored in `docs/ecs-systems/README.md`.
  Verified accurate against the current system list.
- **A canvas UI framework / retained-mode scene graph.** F11's dozen helpers get most of the
  benefit at a fraction of the cost.

---

## Suggested sequence

Each step leaves the game playable and the suite green.

| Step | Finding | Size | Behavior change | Outcome |
| --- | --- | --- | --- | --- |
| 1 | F1 — fix the two stale tests | XS | none | done |
| 2 | F2 — `"strict": true` | XS | none | done |
| 3 | F3 — delete the dead compute fields | XS | none | done |
| 4 | F13 — derive the trait list from `TRAIT_KEYS` | XS | none | done |
| 5 | F5 — HUD overflow guard via `tryDraw` | S | fixes a narrow-window overlap | done |
| 6 | F11 — `ui/draw.ts`, one panel at a time | S–M | none (verify visually) | done, scoped (see F11's own note) |
| 7 | F6 — `ecs/modal.ts`, breaking both import cycles | M | none | done |
| 8 | F7 + F4 — move maintenance and panel clicks out of `input.ts` | M | none | done |
| 9 | F8 — `rackPanelLayout` object | M | none | done |
| 10 | F16 — tests for the now-testable panel/click logic | M | none | done, partial (see F16's own note) |
| 11 | F10 — split the draw modules | L | none | not done — see F10's "Decision" note |
| 12 | F9, F12, F14, F15, F17 — decide individually | S each | none | F9 decided against splitting; F12, F14, F15, F17 done |

Steps 1-5 are mechanical and can go in one pass. Step 6 is independent of everything after it.
Steps 7-9 are the substantive ones and should land separately, each with the suite green in
between. Steps 10-12 are optional and should only happen if 7-9 made the code better in practice
rather than merely different.

## Verification

Per CLAUDE.md, gameplay verification is manual — no browser automation, no agent starting the
project. For every step above:

1. `npx tsc --noEmit` — clean.
2. `npx eslint .` — clean.
3. `npx vitest run` — green (after step 1; 131 tests today).
4. Manual check of whatever the step touched. The steps that need the closest look:
   - **F5** — resize the window narrow with racks overheating and a machine failed; confirm the
     alerts truncate instead of drawing under the mute button.
   - **F11** — open each panel before and after conversion; the colors and bars should be
     pixel-identical, since no value changes.
   - **F6** — open a rack panel, then press `O`; press `J` while the shop is open by proximity;
     right-click a rack while the offers panel is up. Exactly one panel visible each time, and
     clicks land on the one that is visible.
   - **F7** — install, repair and decommission a machine, and cancel each mid-walk. Confirm the
     refunds: install returns stock to inventory, repair returns money, decommission returns
     nothing.
   - **F8** — drag a workload from the tray onto a server, between servers, and back to the
     tray, with the panel scrolled. Hit targets must still line up with what is drawn.
