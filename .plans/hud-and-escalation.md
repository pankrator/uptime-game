# HUD and escalation: making the loop visible and endless

> **Plan 3 of 3.** Depends on `.plans/machines-and-racks.md` and
> `.plans/workload-economy.md`. Those two build a working simulation the player can barely
> see; this one surfaces it and then tunes the difficulty curve against how it actually plays.
>
> This is presentation and balance work — one new system, no new mechanics. It's separated
> because tuning is only meaningful once you can read the numbers, and because mixing balance
> changes into a plan that's also adding systems makes it impossible to tell whether a bad
> playthrough is a bug or a bad constant.

## Context

After plan 2 the game works: contracts arrive, assign, pay, expire; brownouts happen;
reputation moves. But the only visible state is rack LED colors and a temporary money readout.
The player cannot see how close they are to a capacity wall, what a pending contract needs, or
how much time is left on anything — so they cannot make the decisions the game is asking for.

This plan adds the HUD, the peripheral alerts, and then a deliberate tuning pass.

---

## Step 1 — HUD layout (`src/ui/layout.ts`, extended)

Add rect functions alongside plan 1's build-panel geometry. Same pattern as
`getBuildPanelEntryRect`: **one function per region, taking canvas dimensions as parameters,
used by both draw and hit-test.**

```ts
export const HUD_BAR_HEIGHT = 36;
export const HUD_PANEL_WIDTH = 240;
export const HUD_PANEL_MARGIN = 12;
export const HUD_ROW_HEIGHT = 28;

export function getHudBarRect(canvasWidth: number): Rect
export function getWorkloadPanelRect(canvasWidth: number, rowCount: number): Rect
export function getWorkloadRowRect(index: number, canvasWidth: number, rowCount: number): Rect
```

**Never cache these.** `createRenderer` mutates `canvas.width/height` on resize with no
re-layout, so every rect is recomputed each frame from current dimensions — the existing build
panel already works this way.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  $ 1,240   ⚡ 2.8 / 3.0 kW   ❄ 2.1 / 3.0 kW   ★ 62   ▦ 18/24 compute          │  ← 36px bar
├───────────────────────────────────────────────────────────────────────────────┤
│                                                    ┌────────────────────────┐ │
│                                                    │ ACTIVE                 │ │
│     ▓▓ ▓▓ ▓▓                                       │ Web Hosting  ███░░ 32s │ │
│     ▓▓ ▓▓ ▓▓        (datacenter floor)             │ Batch Job    █░░░░ 27s │ │
│                                                    │ PENDING                │ │
│          ☺                                         │ ⚠ Render Farm    14s   │ │
│                                                    │   needs 45, have 20    │ │
│  ┌──────────┐                                      └────────────────────────┘ │
│  │   Rack   │                                                                 │
│  │  Server  │   ← existing build panel, now 5 entries with costs              │
│  │  Blades  │                                                                 │
│  │ +5kW Pwr │                                                                 │
│  │ +5kW Cool│                                                                 │
│  └──────────┘                                                                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 2 — `hud` system (`src/ecs/systems/hud.ts`)

```ts
export function createHudSystem(world: World, renderer: Renderer, facility: EntityId): System
```

Runs **last**, drawn over everything. Reads `Wallet`, `Reputation`, `PowerCapacity`,
`CoolingCapacity`, `Utilization`, `DemandClock`, and the `workloads` store. It **mutates
nothing** — a pure projection of state onto pixels.

### Top bar

- **Money** — `Math.floor(money).toLocaleString()`. Never show cents; a jittering decimal in
  the most-watched number reads as broken, and plan 1's affordability gate already floors, so
  display and logic agree.
- **Power / Cooling** — `used / capacity` to one decimal, each with a small inline bar.
  **Text and bar turn red when over capacity.** This is the single most important signal in
  the game: it's the difference between "income stopped because a contract ended" and "income
  stopped because you tripped the breaker".
- **Reputation** — integer, color-graded (red <30, amber <60, green above).
- **Compute** — `assigned / total`, so idle capacity is visible at a glance. Idle compute is
  the player's cue that they need *contracts*, not machines; a full bar with pending work is
  the cue for the opposite.

### Workload panel

Right side, `ACTIVE` then `PENDING`:

- **Active** — label, progress bar (`elapsedSeconds / durationSeconds`), remaining seconds.
- **Pending** — `⚠`, label, grace countdown, and on a second line **the shortfall**:
  `needs 45, have 20`. That shortfall is the single most actionable number in the game — it
  converts "I'm failing" into "I need 25 more compute", which is a purchase decision.

Cap the list at ~6 rows with a `+3 more` line. Unbounded growth would run off-canvas exactly
when the player is most overwhelmed.

### The HUD is deliberately non-interactive

`input.wasClicked()` is consume-on-read with a single consumer. If the HUD system also called
it, whichever system ran first would silently eat the click, and which one that is depends on
array order — a genuinely nasty bug. **All hit-testing stays in `createInputSystem`**, which
keeps the existing priority chain as the one place clicks are resolved.

The only input change is finishing plan 1's **click-swallow**: a click landing on the HUD bar
or workload panel returns early instead of walking the player to a point underneath it.
Implement `pointerInHud(point, canvas)` in `ui/layout.ts` using the rect functions above, and
call it from `input.ts` before the movement branch.

If a clickable HUD element is ever needed, the right fix is splitting `wasClicked()` into a
consuming `consumeClick()` and a non-consuming `isClickPending()` — not adding a second
consumer.

---

## Step 3 — Peripheral alerts (`src/ecs/systems/render.ts`)

**Pending-contract border.** When any workload is `'pending'`, draw a 3px amber border inset
just inside the building walls, pulsing via `Math.sin(performance.now() / 300)`. Peripheral,
unmissable, and zero layout cost — the player watching their manager walk still registers it.
Escalate to red when any pending workload's grace drops below 5 seconds.

**Offline machines already read as red** from plan 1's slot states. Verify that a brownout is
legible on the floor without looking at the HUD — that's the payoff for the newest-first
shutdown rule, since the machine you just installed is the one that goes dark.

Final draw order: building → racks → install indicator → player → pending border → build panel
→ hud. Painter's order by code order, no z-sort, consistent with what's there.

---

## Step 4 — Reputation gating and escalation, verified

Plan 2 implements `minReputation` gating and the escalation functions. This step **verifies
they produce the intended experience**, which is a different activity from implementing them:

- Archetypes unlock in order as reputation climbs (`batch` at 20, `render` at 40, `training`
  at 60), and the unlock is *noticeable* — if `render` first appears 12 minutes in, the
  weighting in `workload-spawn` needs adjusting, not the threshold.
- Reputation loss visibly slows arrivals. If it doesn't read as a consequence, the 0.8
  multiplier span is too narrow.
- `getComputeScale` growth stays ahead of a passive player but behind an active one.

Consider surfacing `contractsServed` and `peakComputeServed` in the HUD bar or a corner — the
game has no win screen, so a visible personal best is the only thing that makes a long session
feel scored. Cheap: both are already tracked in `DemandClock`.

---

## Step 5 — The tuning pass

**Play the game for 20 minutes before changing a single constant.** The values in
`game-data.ts` are reasoned, not tested; the intended shape is:

| Milestone | Target |
|---|---|
| First contract | ~15 s |
| First income | under 1 min |
| Power wall | ~7 min |
| Cooling wall (via a `render` contract) | ~8–10 min |
| Demand outpaces a passive player | ~15 min |

Tune in this order, because each knob is noisier than the last:

1. **`getArrivalInterval`** — the dominant difficulty knob. Too fast and the player drowns
   before understanding why; too slow and there's no tension at all.
2. **Upgrade costs** ($400 / $350) — these set how long each capacity wall lasts. A wall that
   resolves in under 30 s wasn't a wall.
3. **Pay rates** — change these last. They interact with everything, and $/compute-second is
   deliberately flat across archetypes, so changing one in isolation breaks that property.

**Do not tune machine costs or compute values** unless something is clearly broken — plan 1's
`basic`-vs-`dense` tension (better on both axes, 3.6× the up-front cost) is load-bearing for
the buy decision, and small changes flip which tier is correct when.

Record what changed and why in a short note at the bottom of this file, so the next pass
starts from evidence instead of re-deriving.

---

## Files

### New
| File | Contents |
|---|---|
| `src/ecs/systems/hud.ts` | top bar, workload panel |

### Modified
| File | Change |
|---|---|
| `src/ui/layout.ts` | HUD rect functions, `pointerInHud` |
| `src/ecs/systems/input.ts` | HUD click-swallow branch |
| `src/ecs/systems/render.ts` | pending border; remove plan 2's temporary readouts |
| `src/ecs/game-data.ts` | tuned constants (step 5) |
| `src/main.ts` | `createHudSystem` last in the array |

**Style:** `import { type X }`; no enums (`erasableSyntaxOnly`); no file extensions in imports;
100 cols, single quotes, semicolons, trailing commas. No `strict`/`strictNullChecks` in
`tsconfig` — match the existing `!`-assertion style; the compiler won't catch a missed null
check.

---

## Risks

- **Canvas text rendering is fiddly.** Set `font`, `textAlign`, and `textBaseline` explicitly
  before each group of draws — `drawBuildPanel` already does this, and canvas state is global,
  so a missing reset shows up as misaligned text somewhere unrelated.
- **HUD cost is per-frame.** Deriving the workload list means iterating `workloads` every
  frame at 60fps. Trivial at tens of entities, but don't add per-frame allocations inside
  `forEach` callbacks in the draw path.
- **Tuning is open-ended.** Timebox it. The milestone table above is the acceptance criterion;
  "feels right" without reference to it will consume unlimited time.
- **Small canvases.** At narrow widths the workload panel and build panel could collide. Clamp
  `HUD_PANEL_WIDTH` to a fraction of canvas width, or accept it and note the minimum supported
  size.

## Verification

Manual only — no browser automation, per CLAUDE.md. `npm run lint` and `npm run build` clean.

1. HUD shows $750, 3.0 / 3.0 kW power, 3.0 / 3.0 kW cooling, reputation 50, 0/0 compute at
   start.
2. Money in the bar matches what the build panel's affordability dimming implies — a $250
   entry is enabled exactly when the bar reads $250 or more.
3. Installing machines raises the compute total; assigning a contract raises `assigned`.
4. Exceeding power turns that bar **red**, and the newest machines show red LEDs on the floor.
   Cooling behaves independently.
5. Active contracts show a progress bar that fills and a countdown that decrements.
6. A pending contract shows `⚠`, its grace countdown, and a correct shortfall
   (`needs N, have M` matching the compute readout).
7. The building border pulses amber while anything is pending, red under 5 s of grace, and
   clears when nothing is pending.
8. Clicking the HUD bar or workload panel does **not** move the player and does not cancel an
   in-progress install.
9. Clicking the build panel and the floor still behave exactly as before. *(regression)*
10. Resize the window: HUD, workload panel, and build panel all reposition correctly with no
    stale layout.
11. Play 20 minutes: milestones land near the table in step 5; `batch`, `render`, and
    `training` all unlock and appear.
