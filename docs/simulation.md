# Simulation harness

`src/sim/` — plays the game headlessly so logic and balance can be checked without a browser.

It builds the same world, the same entities and the same system pipeline `main.ts` builds, then
advances it by hand instead of by a timer. A scripted player drives it through the same domain
entry points the click chain calls. Nothing here is part of the shipped bundle — `main.ts`
never imports it, so it tree-shakes out of the build entirely.

## Why it exists

Two questions the unit tests can't answer:

- **Does the world stay consistent over a long run?** Most state corruption (a workload bound
  to a destroyed server, free capacity going negative, a machine online on a tripped rack) only
  appears after a specific sequence across several systems, not in any one system's tests.
- **Is the economy winnable?** Whether buying a server pays for itself, whether reputation
  helps or hurts, whether a rack can hold what its slot count says — none of that is visible in
  the constants. It has to be played.

## Running it

```sh
npx vitest run src/sim            # the scenarios, pass/fail on invariants
VERBOSE_SIM=1 npx vitest run src/sim --disable-console-intercept   # + a per-minute timeline
```

The verbose timeline is the readout a balance check-up actually reads: money, reputation,
contracts served, what got built, revenue and power cost per second, hottest rack, worst wear.

## The pieces

| Module | What it is |
| --- | --- |
| `simulation.ts` | `createSimulation()` — world + entities + the real pipeline, with `tick()`/`run()`. Also `withSeededRandom`, which makes a whole run reproducible. |
| `headless.ts` | Inert `Renderer`/`Camera`/`InputStateTracker`/`Audio` doubles, so every system factory can be constructed without a DOM. |
| `player.ts` | `createScriptedPlayer()` — a configurable stand-in for a human, expressed as buy strategy, thermal management, repair thresholds, servers per rack, whether to accept work nothing can serve. |
| `invariants.ts` | `checkInvariants()` — the rules the world must satisfy after every tick, returned as a list rather than thrown, so a long run reports the first tick each rule broke. |
| `snapshot.ts` | A flat, printable reading of the facility, plus a one-line formatter. |

The update order itself lives in `src/ecs/pipeline.ts`, shared with `main.ts`. That is
deliberate: the order is load-bearing (see the comment there), and a harness with its own copy
of it would eventually be testing a pipeline the game no longer runs.

## Writing a new check

```ts
withSeededRandom(12345, () => {
  const sim = createSimulation();
  const player = createScriptedPlayer(sim, { buyStrategy: 'blade-only', manageThermals: true });

  sim.run(10 * 60, {
    driver: player,
    onTick: (current) => {
      for (const breach of checkInvariants(current.world, current.facility)) {
        // ...
      }
    },
  });
});
```

`driver` runs before each tick, which is where the player acts; `onTick` runs after, which is
where sampling and invariant checks go. To probe one mechanic rather than a whole session,
skip the scripted player and drive the world directly — `sim.world` and `sim.facility` are the
real ones, so `placeWorkload`, `startDecommission`, `buy` and friends all work against them.

## What it does and does not model

Faithful: the full system pipeline in its real order, pathfinding and walking, install/repair/
decommission including the walk-to-rack and arrival, brownouts, thermal trips and recovery,
wear and failure, offer arrival and expiry, deadlines and payouts.

Not modelled — both make a run an **upper bound** on the economy rather than a transcript of
one, so treat its money figures as a ceiling a real player would not reach:

- **Buying skips the trip to the shop.** The scripted player calls `buy()` directly instead of
  walking into `shop.ts`'s proximity range.
- **Dispatching skips the trip to the rack.** It calls `dispatch.ts` directly rather than
  opening a rack panel, walking there and dragging a card.

Also worth knowing: `performance.now()` drives toast/floating-text expiry, the brownout restore
grace window and the panel confirm windows. A simulated run advances game time far faster than
wall clock, so anything on that clock behaves as if barely any time has passed. Gameplay state
is unaffected, but don't use the harness to check those windows.

`createWorld()` resets the module-level component stores, so **only one `Simulation` can be
live at a time** — creating a second one invalidates the first.
