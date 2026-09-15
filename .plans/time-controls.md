# Time controls: pause, fast-forward, and a clock the player owns

> **Plan 7.** Depends on nothing. Touches `src/core/index.ts`, `src/state/index.ts`,
> `src/ecs/systems/hud.ts`, `src/ecs/systems/input.ts`, and `src/ui/layout.ts`. No new
> components, no new ECS systems.
>
> Deliberately first among the "make it more fun" plans because every later plan is tuned by
> *watching* the simulation, and today you can only watch it at 1x with no way to stop it.
> Thermal creep (`.plans/thermal-and-cooling.md`) and wear curves
> (`.plans/hardware-failure.md`) are slow phenomena; validating them at 1x is the difference
> between a ten-minute test and a ninety-second one.

## Context

`createGameLoop` ([core/index.ts:23-71](src/core/index.ts#L23-L71)) runs update systems on a
fixed `setInterval` at `UPDATE_HZ = 30` and computes `deltaSeconds` from wall-clock
`performance.now()` deltas, clamped by `MAX_DELTA_SECONDS = 0.1`. Every update system takes
`deltaSeconds` and scales its own work by it — `workload-run.ts` pays
`payPerSecond * deltaSeconds`, `workload-spawn.ts` decrements `nextArrivalInSeconds`,
`install-progress.ts` decrements `secondsRemaining`, `movement.ts` moves
`pixelsPerSecond * deltaSeconds`.

That uniform discipline is exactly what makes this plan cheap: **there is one number to
multiply.** No system reads the clock directly, so no system needs to change.

What the player gets: a pause during a crisis (three offers expiring, a brownout, and a rack
panel open all at once is currently unmanageable), and a fast-forward through the dead time
that the shop walk and long `workSeconds` contracts create.

---

## Design decisions

### D1. Time scale multiplies `deltaSeconds`; it does not change the tick rate

```ts
const deltaSeconds = Math.min(rawDelta, MAX_DELTA_SECONDS) * timeScale;
```

The `setInterval` stays at 30Hz. At 4x each tick simply advances the world by four times as
much simulated time.

The alternative — ticking four times as often — was rejected: it multiplies the cost of every
system by the speed factor (each of `resource.ts` and `capacity.ts` is O(machines × workloads)
per tick), and it makes frame cost depend on a UI setting. Scaling delta keeps the CPU cost
flat at every speed.

The cost of this choice: at 4x, one tick advances up to 0.4 simulated seconds, so
integration is coarser. Nothing in this game integrates anything stiff — the worst case is a
workload finishing up to 0.4s "late" in simulated terms, which is invisible. If a future
system needs fine steps, it can sub-step internally; the loop does not need to know.

### D2. Pause is `timeScale === 0`, not a separate flag

A paused game is a game where no simulated time passes. Expressing that as a scale of `0`
rather than an `if (paused) return` means there is exactly one code path, and a system can
never accidentally observe "paused but still ticking".

**Rendering must keep running while paused.** `render()` is a separate `requestAnimationFrame`
chain that already passes `0` as its delta ([core/index.ts:45-54](src/core/index.ts#L45-L54)),
so it is already time-independent. Verify no render system animates off its delta — a paused
game must still redraw so panels, hover states, and the camera keep responding.

### D3. Camera and input stay live while paused

The player must be able to pan, open a rack panel, read trait bars, and inspect the floor while
paused — that is most of the value. But `createInputSystem` and `createCameraSystem` are
`updateSystems`/`renderSystems` entries that would be frozen by a blanket scale.

Resolve by **splitting the update list in two**:

```ts
const realtimeSystems = [ createInputSystem(...), createRackPanelSystem(...), createShopSystem(...) ];
const simulationSystems = [ /* everything else */ ];
```

`realtimeSystems` always receive unscaled `deltaSeconds`. `simulationSystems` receive
`deltaSeconds * timeScale`.

This is the one genuinely load-bearing decision in the plan, and it cuts across the ordering
comment in [main.ts:56-71](src/main.ts#L56-L71). See D4.

### D4. The split must preserve today's system ordering

`main.ts` documents an order that is explicitly load-bearing: install-progress before movement,
rack-panel after movement but before capacity, resource before capacity before workload-run.
Splitting into two arrays and running all of one then all of the other **would break that** —
`rack-panel` (realtime) must still run after `movement` (simulation) and before `capacity`
(simulation).

So do **not** run two arrays back to back. Instead keep **one ordered array** whose entries
carry a flag:

```ts
export interface System { update(deltaSeconds: number): void }

export interface ScheduledSystem {
  system: System;
  timescaled: boolean;  // false = always gets real delta (input, panels, camera)
}
```

The loop iterates the single array in order, passing each entry the delta it asked for:

```ts
for (const entry of updateSystems) {
  entry.system.update(entry.timescaled ? scaledDelta : rawDelta);
}
```

Order is preserved exactly; only the delta each system sees changes. This keeps the ordering
comment in `main.ts` true and reviewable.

### D5. `rack-panel` and `install-progress` are split across the boundary

Two systems do two jobs and land awkwardly:

- **`rack-panel.ts`** handles pointer/drag (must be realtime) *and* ticks `RejectedDrop`
  expiry and commits `PendingDrop` (simulation-ish). Mark it **realtime**. `RejectedDrop`'s
  red flash is UI feedback measured in wall-clock milliseconds via `expiresAtMs`
  ([components.ts](src/ecs/components.ts)) — it already uses wall-clock, not delta, so it is
  correct as-is. Committing a `PendingDrop` on arrival is an event, not an accumulation, so it
  does not care about the delta value.
- **`install-progress.ts`** ticks `secondsRemaining`, which is in-world time — an install
  should genuinely finish 4x sooner at 4x. Mark it **timescaled**.

### D6. Speed is UI state, not a component

`timeScale` lives in `GameState` ([state/index.ts](src/state/index.ts)), which already holds
`scene`. It is not simulation state — nothing in the world reacts to it, no system queries it,
and it should not be part of a future save of the facility. Putting it in a component would
mean every system could read it, which is precisely the coupling to avoid.

### D7. Speeds are a fixed ladder

`[0, 1, 2, 4]`. Not continuous — a slider invites 3.7x, which is untestable and
indistinguishable from 4x. Four buttons are self-explanatory and map to four keys.

Cap at 4x rather than 8x+: above ~4x the player cannot react to a brownout before it cascades,
which converts fast-forward from a convenience into a way to lose without seeing why.

---

## Step 1 — `timeScale` in game state

`src/state/index.ts`:

```ts
export const TIME_SCALES = [0, 1, 2, 4] as const;
export type TimeScale = (typeof TIME_SCALES)[number];

export interface GameState {
  scene: Scene;
  timeScale: TimeScale;
  lastRunningScale: Exclude<TimeScale, 0>;  // what to restore when unpausing
}
```

`lastRunningScale` exists so that pause→unpause returns to 2x if the player was at 2x, rather
than dumping them back to 1x. Initialize `timeScale: 1`, `lastRunningScale: 1`.

Helpers in the same file:

```ts
export function setTimeScale(state: GameState, scale: TimeScale): void
export function togglePause(state: GameState): void   // 0 <-> lastRunningScale
export function cycleTimeScale(state: GameState, direction: 1 | -1): void
```

Keep them pure functions over `GameState` — no DOM, no canvas — so they stay testable alone.

## Step 2 — the loop honors it

`src/core/index.ts`:

Note `main.ts` now builds all of this inside a `runGame(canvas)` function called from the
landing screen's start callback — `state` is a local there, so it is already threaded into
`createGameLoop`. Nothing about the landing flow changes; `timeScale` simply starts at 1.

1. Change `updateSystems: System[]` to `updateSystems: ScheduledSystem[]` in `GameLoopDeps`.
2. Add `ScheduledSystem` to `src/ecs/systems/system.ts` next to `System`.
3. In `update()`, compute both deltas and dispatch per D4:

```ts
const rawDelta = Math.min(lastUpdateTime ? (now - lastUpdateTime) / 1000 : 0, MAX_DELTA_SECONDS);
const scaledDelta = rawDelta * state.timeScale;
```

Note `createGameLoop` currently destructures only `{ renderer, updateSystems, renderSystems }`
and drops `state` and `input` ([core/index.ts:23](src/core/index.ts#L23)) — it must now keep
`state`.

**Clamp before scaling, not after.** `MAX_DELTA_SECONDS` guards against a hitched frame
(alt-tab, GC pause) delivering a huge delta; scaling afterward is intentional, because at 4x
the player *asked* for 0.4s steps.

## Step 3 — helper for building the list

In `src/ecs/systems/system.ts`:

```ts
export function realtime(system: System): ScheduledSystem { return { system, timescaled: false }; }
export function timescaled(system: System): ScheduledSystem { return { system, timescaled: true }; }
```

Then the `updateSystems` list inside `runGame()` in `main.ts` reads as a single ordered list
with the classification visible inline, and the existing ordering comment stays directly above
it, still accurate:

```ts
const updateSystems = [
  realtime(createInputSystem(world, input, renderer, player, facility, camera)),
  timescaled(createInstallProgressSystem(world, player, facility)),
  timescaled(createPathFollowSystem(world)),
  timescaled(createMovementSystem(world)),
  realtime(createRackPanelSystem(world, input, renderer, player, camera)),
  realtime(createShopSystem(world, player)),
  timescaled(createResourceSystem(world, facility)),
  timescaled(createCapacitySystem(world, facility)),
  timescaled(createWorkloadSpawnSystem(world, facility)),
  timescaled(createOfferExpirySystem(world)),
  timescaled(createWorkloadRunSystem(world, facility)),
];
```

A judgement call worth stating: **movement and path-follow are timescaled**, so the player
walks 4x faster at 4x. The alternative (realtime movement) means at 4x the player crawls
relative to a world moving four times faster, making the shop walk *feel* four times longer —
the opposite of the intent.

**`shop.ts` is realtime** because it is pure proximity detection driven by position, and it
opens/closes a panel. It accumulates nothing.

## Step 4 — controls

**Keys**, in `input.ts`'s existing key handling:
- `Space` — toggle pause
- `1` / `2` / `3` — 1x / 2x / 4x

⚠️ **Conflict:** number keys `1`–`5` are already build-panel hotkeys derived from
`BUILDABLES` ([components.ts](src/ecs/components.ts) and
[.plans/build-panel.md](.plans/build-panel.md)). Do **not** overload them. Use `,` and `.`
(the comma/period convention from Factorio/Rimworld) for slower/faster, plus `Space` for
pause. That leaves the build hotkeys untouched.

Also check `Space` is not already bound before claiming it; if it is, fall back to `P`.

**Buttons**, in the HUD bar. Add to `src/ui/layout.ts`, following the one-function-per-region
rule that the rest of the file obeys:

```ts
export const SPEED_BUTTON_WIDTH = 32;
export const SPEED_BUTTON_HEIGHT = 22;
export const SPEED_BUTTON_GAP = 4;

export function getSpeedButtonRect(index: number, canvasWidth: number): Rect
```

Place them at the right end of `getHudBarRect(canvasWidth)`. Four buttons: `❚❚`, `1x`, `2x`,
`4x`, with the active one highlighted.

⚠️ **The HUD is currently non-interactive by design** — `.plans/machines-and-racks.md` step
notes state "the HUD is strictly non-interactive", and `pointerInHud` exists to let world
clicks be swallowed. These buttons are the first interactive HUD element, so:

1. `input.ts` must hit-test the speed buttons **before** the world branch, in the same
   ordered click chain as the build panel and offer cards.
2. `pointerInHud` already returns true for the HUD bar rect, so clicks there are already
   swallowed from the world — the buttons only need a positive branch, not a new guard.

## Step 5 — draw the state

In `hud.ts`, draw the four buttons and highlight the active scale.

When paused, draw an unmissable indicator — a "PAUSED" pill centered at the top of the
viewport (`getGameViewportRect`), not just a subtle button highlight. A player who does not
notice they are paused will read it as the game being frozen or broken.

Optionally dim the world slightly while paused. Keep it subtle (≤15% black overlay) so trait
bars and heat colors stay readable.

## Step 6 — tuning pass

With fast-forward available, re-check the constants that were tuned blind:

- `getArrivalInterval` and `getComputeScale` ([game-data.ts](src/ecs/game-data.ts)) ramp over
  300–450 simulated seconds. At 4x that is a ~2-minute test instead of ~8.
- Confirm nothing breaks at 4x for a sustained run: reputation staying in `[0, 100]`, offers
  capped at `MAX_OFFERS`, no negative `free` traits in `capacity.ts`, brownout recovery not
  oscillating (`BROWNOUT_COOLDOWN_SECONDS = 1.0` is only 30 ticks at 1x, and ~7 at 4x —
  **watch specifically for flapping here**, since a cooldown measured in simulated seconds
  elapses in a quarter of the wall-clock time and a machine may re-trip before the player can
  react).

If brownouts flap at 4x, the fix is raising `BROWNOUT_COOLDOWN_SECONDS`, not special-casing
speed — a cooldown that is too short at 4x was always too short, just not visibly.

---

## Files

| File | Change |
| --- | --- |
| `src/state/index.ts` | `timeScale`, `lastRunningScale`, `TIME_SCALES`, pause/cycle helpers |
| `src/ecs/systems/system.ts` | `ScheduledSystem`, `realtime()`, `timescaled()` |
| `src/core/index.ts` | keep `state`; compute scaled delta; dispatch per entry flag |
| `src/main.ts` | wrap each system in `realtime()`/`timescaled()` |
| `src/input/index.ts` | `,` / `.` / `Space` bindings |
| `src/ecs/systems/input.ts` | speed-button hit-test branch, before the world branch |
| `src/ui/layout.ts` | `getSpeedButtonRect` |
| `src/ecs/systems/hud.ts` | draw buttons, active highlight, PAUSED indicator |

## Trade-offs worth flagging

- **The realtime/timescaled split is a new concept every future system must classify.** That
  is the real cost of this plan. Mitigate with a one-line rule in `system.ts`: *if it
  accumulates simulated time (`x -= dt`), it is timescaled; if it reacts to the pointer or
  wall-clock, it is realtime.*
- **Pause makes "think time" free.** The offer-accept decision is currently under mild time
  pressure from `offerSeconds`. A player can now pause and deliberate indefinitely. This is
  the correct trade for a management game — the pressure should come from *capacity*, not
  reading speed — but be aware it removes a small existing difficulty source.
- **4x plus a walking player may expose pathfinding cost.** A* runs on click, not per tick,
  so this is unlikely; but if a long path at 4x hitches, the fix is path caching, not a lower
  speed cap.

## Verification

Per CLAUDE.md: no browser automation, no starting the project from here — manual validation.

1. `npx tsc --noEmit` clean after each step.
2. **Pause:** `Space` freezes workload timers, offer countdowns, movement, income. Camera pan,
   rack-panel open/scroll, and hover still work. "PAUSED" is clearly visible.
3. **Unpause restores the previous speed**, not 1x (set 2x, pause, unpause → still 2x).
4. **2x/4x:** a contract's `workRemainingSeconds` visibly drains proportionally faster; income
   accrues proportionally faster; the player walks proportionally faster.
5. **No double-count:** a 45s `web` contract at 4x completes in ~11s wall-clock and pays
   approximately the same total money as at 1x (`payPerSecond × workSeconds`). A payout that
   scales with speed means a system is reading wall-clock instead of its delta.
6. **Build hotkeys `1`–`5` still select buildables** and are not stolen by speed controls.
7. **Sustained 4x run (~3 min wall-clock):** reputation stays in range, offers stay capped,
   no brownout flapping, no negative free capacity.
