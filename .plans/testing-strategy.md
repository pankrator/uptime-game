# Testing strategy: how to validate this game without a browser

> **Proposal, not yet built.** No test runner is configured today (`package.json` has no test
> script, no `vitest`/`jest`/`@testing-library` dependency, and no `*.test.ts` file exists
> anywhere in `src/`). Per CLAUDE.md, validating the *running* game is manual and stays that
> way — this plan is about everything that can be checked **before** a human ever opens the
> game, so manual playtesting spends its time on feel and polish, not on catching regressions
> that a fast, headless check would have caught in CI.

## Why this is worth doing now

`.plans/playtest-findings.md` is the evidence. Read as a test-gap report, its bugs split
cleanly into two families, and both families are checkable without a canvas or a browser:

- **B3** (demand scaling dead — "the game has no progression") was a pure-math bug in
  `getComputeScale`/`getArrivalInterval` (`game-data.ts`). A single unit test asserting
  `capacityScale` grows as installed capacity grows would have caught it the moment it was
  written, instead of after a played session and a hand-built 22-minute trace table.
- **B1, B2, B5, F6** (banner blocks the shop door, warning text hidden under a button, HUD
  overflow at narrow widths, offer cards reflowing under the cursor) were all geometry bugs in
  `src/ui/layout.ts` — rectangles that overlap or clip when given real canvas dimensions.
  `layout.ts` is ~35 pure functions (`getHudBarRect`, `getOfferCardRect`,
  `getTutorialBannerRect`, `pointerInHud`, …) that take numbers in and return `Rect` out. None
  of them touch a `CanvasRenderingContext2D`. Every one of those four bugs is expressible as
  "these two rects must not overlap at width W" — a one-line assertion, no rendering required.

Neither family needed the dev server, a browser, or Playwright to catch — they needed a
function call and an `expect()`. That's the gap this plan closes.

## What the codebase already set up for this

The project's own conventions (`.plans/README.md`, code comments in `traits.ts`, `dispatch.ts`)
already anticipate testability:

- `world.ts` is a ~60-line in-memory `Map`-backed ECS with no DOM/canvas dependency. Building a
  `World`, adding components, and calling `system.update(dt)` in a loop works identically in
  Node and in the browser.
- "Pure math lives in its own ECS-free module... so it is testable alone" is a stated design
  rule (`.plans/README.md`), followed by `traits.ts`, `thermal.ts`, `wear.ts`.
- `dispatch.ts` is explicitly "the only place workload placement mutates" — a single-file
  surface for the placement invariant (`Workload.state` / `PlacedOn` / `ServerCapacity.free`
  staying consistent), which is exactly the kind of invariant a unit test is good at guarding.
- Every system already takes `deltaSeconds` and nothing else time-related — no system reads
  the wall clock — so driving N simulated seconds in a test is just calling `update()` in a
  loop, the same trick `time-controls.md` step 6 already describes doing by hand.

This plan doesn't restructure anything — it just points a test runner at what's already shaped
for it.

---

## D1. Tool: Vitest

Vite is already the build tool, so Vitest needs no separate config, shares `tsconfig.json` and
path resolution, and runs in watch mode as fast as the dev server reloads. Alternatives
considered and rejected: **Jest** (needs its own transform config to understand Vite's
TS/ESM setup — friction with zero benefit here); **node:test** (no watch-mode re-run,
no `expect`-style matchers, would mean hand-rolling assertions). Nothing in this plan needs
jsdom — every target module is either pure functions or a `World` with no DOM access — so the
default `node` test environment is enough; do not add `jsdom` unless a later test actually
needs it.

```json
// package.json
"devDependencies": { "vitest": "^..." },
"scripts": { "test": "vitest run", "test:watch": "vitest" }
```

Colocate tests next to source (`src/ecs/traits.test.ts` beside `traits.ts`), matching how
`docs/ecs-systems/*.md` already colocates one doc per system — one test file per module, easy
to find, easy to keep in sync.

## D2. Three layers, in priority order

### Layer 1 — Pure math (highest value, cheapest to write)

Target: `traits.ts`, `thermal.ts` (the ECS-free one, not `systems/thermal.ts`), `wear.ts`,
the scaling functions in `game-data.ts` (`getComputeScale`, `getArrivalInterval`,
`clampReputation`), `pathfinding.ts`'s A* itself (given a grid and start/goal, assert the
returned path).

No `World`, no components — call the function, assert the output. This is where **B3 lives**:

```ts
// game-data.test.ts
it('capacityScale grows with installed facility CPU, not with peak completed workload', () => {
  const scaleAt10CpuInstalled = getComputeScale({ installedCpu: 10, ... });
  const scaleAt300CpuInstalled = getComputeScale({ installedCpu: 300, ... });
  expect(scaleAt300CpuInstalled).toBeGreaterThan(scaleAt10CpuInstalled);
});
```

### Layer 2 — Layout geometry (catches the B1/B2/B5/F6 family)

Target: `src/ui/layout.ts`. Assert invariants across a matrix of canvas sizes (the project
already knows its problem sizes: 1280×800 baseline, ~820×600 narrow, the ≤1100px-wide
threshold from B5):

```ts
it.each([[820, 600], [1100, 700], [1280, 800]])(
  'tutorial banner never overlaps the offers or workload columns at %ix%i',
  (w, h) => {
    const banner = getTutorialBannerRect(w, h);
    expect(rectsOverlap(banner, getOffersPanelRect())).toBe(false);
  },
);

it('offer card slots never overlap each other', () => {
  for (let a = 0; a < MAX_OFFERS; a++) {
    for (let b = a + 1; b < MAX_OFFERS; b++) {
      expect(rectsOverlap(getOfferCardRect(a), getOfferCardRect(b))).toBe(false);
    }
  }
});
```

A small `rectsOverlap(a, b)` test helper is the only new code this layer needs. This is the
highest-leverage layer relative to its size: four of the seven bugs in the playtest report are
exactly this shape, and none of them require rendering a pixel.

### Layer 3 — System behavior over simulated time (catches invariant/economy bugs)

Target: `resource.ts`, `capacity.ts`, `wear.ts` (the system), `workload-run.ts`,
`workload-spawn.ts`, `dispatch.ts`-driven placement — run headless against a hand-built
`World`:

```ts
it('placing a workload that exceeds free capacity is rejected, not silently truncated', () => {
  const world = createWorld();
  const server = makeServer(world, { cpu: 4, ramGb: 8, storageGb: 250 });
  const workload = makeWorkload(world, { demands: { cpu: 8, ramGb: 4, storageGb: 10 } });
  expect(checkPlacement(world, workload, server)).toEqual(['cpu']);
});

it('a sustained 5-minute simulated run keeps reputation in [0, 100] and free capacity non-negative', () => {
  const { world, facility, systems } = buildMinimalFacility();
  for (let t = 0; t < 300; t += 1 / 30) runOnce(systems, 1 / 30);
  expect(world.getComponent(reputations, facility)!.value).toBeGreaterThanOrEqual(0);
  expect(world.getComponent(reputations, facility)!.value).toBeLessThanOrEqual(100);
});
```

This is the automated version of the manual "tuning pass" `time-controls.md` step 6 already
describes doing by eye (reputation in range, offers capped, no negative free capacity, no
brownout flapping) — turning a one-off manual check into a regression test that runs on every
change. It needs a handful of small builder helpers (`makeServer`, `makeWorkload`,
`buildMinimalFacility`) — a `src/ecs/test-helpers.ts` shared across this layer's test files,
built incrementally as tests need them rather than speculatively up front.

## D3. What stays manual (deliberately out of scope here)

`render.ts`, `hud.ts`'s drawing code, `input.ts`'s pointer-event wiring, and general game feel
are not part of this plan. They need a real canvas and, more importantly, a human judging
whether something *feels* right — a screenshot diff can tell you a pixel changed, not whether
the change is good. Per CLAUDE.md, that validation is yours, manually, against the running
dev server. What this plan buys you is fewer trips to manual testing in the first place: a
logic or layout bug gets caught by `npm test` in CI-speed seconds, so the manual pass is spent
on the game itself instead of rediscovering bugs like B1/B2/B3/B5/F6.

If you later want automated pixel/interaction coverage (visual regression, scripted click
chains), that's a separate decision to make deliberately — it's a heavier tool with its own
maintenance cost (brittle to intentional UI changes), and CLAUDE.md's current rule keeps it out
of this agent's hands regardless. Worth raising explicitly rather than silently deciding either
way, if it comes up later.

## D4. Wiring it in

- `npm test` runs Vitest once (CI-friendly, non-watch); `npm run test:watch` for local dev.
- Add `test` alongside the existing `lint`/`format`/`build` scripts so a future CI workflow
  (none exists yet — no `.github/workflows/`) can run `npm run build && npm test` as a single
  gate, if/when you set one up.
- `npx tsc --noEmit` (already used as a verification step in every plan) plus `npm run lint`
  are the cheapest possible checks and cost nothing to run alongside `npm test` — they already
  catch a class of bugs (type mismatches, unused state) before either test layer would.

---

## Files

| File | Change |
| --- | --- |
| `package.json` | add `vitest` devDependency; `test`/`test:watch` scripts |
| `src/ecs/traits.test.ts`, `thermal.test.ts`, `wear.test.ts` | Layer 1 |
| `src/ecs/game-data.test.ts` | Layer 1 — `getComputeScale`, `getArrivalInterval`, the B3 regression test |
| `src/ecs/pathfinding.test.ts` | Layer 1 |
| `src/ui/layout.test.ts` | Layer 2 — rect-overlap matrix across known problem widths |
| `src/ecs/dispatch.test.ts` | Layer 3 — placement invariant |
| `src/ecs/systems/*.test.ts` (resource, capacity, wear, workload-run, workload-spawn) | Layer 3 |
| `src/ecs/test-helpers.ts` | shared `World`/entity builders for Layer 3, grown incrementally |

## Suggested build order

1. **Layer 2 on `layout.ts`** first — smallest, catches a real bug class from the playtest
   report immediately, needs zero test infrastructure beyond `rectsOverlap`.
2. **Layer 1 on `game-data.ts`** — write the B3-shaped regression test even though B3 is
   already fixed, as the template for "a scaling function must be monotonic in the right
   variable" going forward.
3. **Layer 1 on the rest** (`traits.ts`, `thermal.ts`, `wear.ts`, `pathfinding.ts`) as each is
   touched by future plans — no need to backfill everything at once.
4. **Layer 3**, starting with `dispatch.ts` (smallest surface, the invariant is already
   documented in its own header comment) before the heavier multi-system simulated-run tests.

## Trade-offs worth flagging

- **This doesn't replace manual playtesting** — it removes the bugs manual playtesting is bad
  at finding by inspection (arithmetic that's wrong at scale, geometry that only overlaps at
  one specific width) so playtesting time goes to the bugs it's good at finding (does this feel
  bad, is this fun, is this confusing).
- **Layer 3 tests are the most expensive to write and the most valuable to have** — they're the
  only layer that catches cross-system bugs (an ordering dependency violated, a brownout
  cascading). Budget for test-helper churn as the ECS grows; that cost is already partly paid
  by `dispatch.ts` and the systems' existing single-responsibility boundaries.
- **No visual/interaction automation is proposed.** CLAUDE.md rules it out for this agent
  today, and even without that constraint it's a heavier, more brittle tool than the three
  layers above — worth revisiting only if a specific class of bug keeps slipping through them.
