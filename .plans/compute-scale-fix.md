# Fixing the compute-scale deadlock

> **Bug fix, not a feature plan.** Fixes B3 from `.plans/playtest-findings.md` — see that
> entry for the original repro and measurements. Touches `src/ecs/game-data.ts`,
> `src/ecs/systems/workload-spawn.ts`, and `src/entities/index.ts`. No new components, no new
> systems.

## Context

`getComputeScale(elapsedSeconds, peakComputeServed)` is supposed to grow demand over a played
session, bounded by both a 10-minute time ramp and the player's demonstrated capacity. In
practice it is permanently pinned at `1.0`:

```ts
const capacityScale = Math.max(1, peakComputeServed / 30);
```

`peakComputeServed` is set from `workload.demands.cpu` of a single **completed** workload, and
the largest CPU demand anywhere in the catalog (training, unscaled) is `12`. So
`peakComputeServed` can never exceed `12`, `capacityScale` is pinned at `max(1, 0.4) = 1`
forever, and `Math.min(timeScale, capacityScale)` is pinned at `1` regardless of `timeScale`'s
own ramp toward 3x. See B3 in `.plans/playtest-findings.md` for the measured trace confirming
this — `scale` stays exactly `1.000` across a simulated 22 minutes.

The direct fix (base `capacityScale` on facility-wide installed capacity instead of a single
job) is one line. But naively letting the achieved scale climb toward `timeScale`'s existing 3x
ceiling breaks something the deadlock had been silently hiding: **the catalog cannot fit a
scaled-up job.**

## Design decisions

### D1. Facility CPU replaces `peakComputeServed` as the capacity signal

`capacity.ts` already computes `Utilization.traitsTotal.cpu` every tick — the summed CPU of
every **online** installed machine, the real "how much has this player actually built" number.
`peakComputeServed` reflects one job's size, which the catalog caps below the divisor no matter
how big the facility gets. Swap the input; keep the same `max(1, x / divisor)` shape.

`peakComputeServed` itself is untouched — `workload-run.ts` still updates it, `hud.ts` still
shows it as the "peak" personal-best stat. It just stops feeding this formula.

### D2. Demand size and contract value are no longer the same number

Computed the largest scale factor at which each `scales: true` archetype still fits **some**
machine tier on every trait (same check `traits.ts`'s `fits` does, just solved for the
multiplier):

| Archetype | Max fittable scale | Bottleneck tier / trait |
| --- | --- | --- |
| `batch` | 4.0x | `dense`, CPU |
| `render` | 2.5x | `dense`, storage |
| `training` | 1.33x | `dense`, RAM (`memory` ties at 1.0x on CPU) |

If a single `scale` value drove both `payPerSecond` and `demands` toward the intended 3x
ceiling, `training` (and eventually `render`) would start rolling offers no server can ever
serve well before elapsedSeconds/capacity got anywhere near that ceiling — trading B3's "demand
never grows" for a worse failure mode, "high-value demand is unfillable forever," the instant
the deadlock was fixed naively.

Split the one scale into two:

- **Value scale** (`getValueScale`, the renamed `getComputeScale`) drives `payPerSecond` and
  `penaltyOnMiss`. Uncapped by fit — this is the number the original `timeScale` comment already
  intended to reach 3x ("ramps to 3x over 10 min, then flat"); nothing here changes that
  ceiling, it only makes the ceiling reachable.
- **Demand scale** (`getDemandScale`) drives `demands` (server-fit sizing). Clamped to
  `MAX_DEMAND_SCALE[archetypeId]`, computed once from `MACHINE_TIERS`/`WORKLOAD_ARCHETYPES`
  themselves (not hand-typed) — the same "verified against every tier's trait triple, not just
  one" discipline the existing Step-9 comments in `game-data.ts` already apply to the
  *unscaled* demands, generalized across every scale a played session can reach.

Net effect: once a `scales: true` archetype's demand scale hits its fit ceiling, its **size**
stops growing but its **pay** keeps climbing toward 3x — late-game growth becomes "the same
training job pays more," not "an unfittable training job." `workSeconds`/`deadlineSeconds` were
never scaled by either value and stay archetype-fixed, so this doesn't change how a scaled
job's timing works, only its size and rate.

`MAX_DEMAND_SCALE[archetypeId] >= 1` for every archetype in the catalog today (each fits some
tier unscaled, confirmed by the Step-9 comments), and both `getValueScale` and `getDemandScale`
have a floor of `1` — so nothing here can push an early-game offer *below* what it is today.

### D3. `CAPACITY_SCALE_CPU_DIVISOR` stays `30`, now meaning something

The divisor was already `30`; it just never mattered, since the input it was dividing
(`peakComputeServed`) topped out at 12. With facility CPU as the input: starting hardware (2x
Budget Box, 8 CPU) keeps `capacityScale` at its floor of `1`; a measured autoplay session
(`.plans/playtest-findings.md`'s reproduction) reached `traitsTotal.cpu = 42` after 95 seconds
of steady play, giving `capacityScale ≈ 1.4` — a small, plausible early bump. Reaching `3`
(matching `timeScale`'s own cap) needs `90` CPU, roughly 3 Blade Chassis or a dozen Servers —
a few minutes of continued investment past that point, not an instant unlock and not
end-of-game-only.

## Verification

Per CLAUDE.md: manual validation, no browser automation or starting the project from here.

1. `npx tsc --noEmit` and `npm run lint` clean.
2. **Deadlock is gone:** with `traitsTotal.cpu` fixed at, say, 60 and `elapsedSeconds` swept
   from 0 to 900, `getValueScale` should rise smoothly rather than sitting at exactly `1.000`.
3. **Fit safety holds at the ceiling:** for every `scales: true` archetype, `demands` scaled by
   `MAX_DEMAND_SCALE[archetypeId]` still fits the tier `D2`'s table names, on every trait.
4. **Value keeps climbing past the demand ceiling:** push `elapsedSeconds`/facility CPU well
   past what `training` needs to hit its 1.33x demand ceiling, and confirm `payPerSecond`
   keeps rising toward the 3x envelope while `demands` stays flat at the 1.33x-scaled size.
5. **Early game is unchanged:** starting hardware + a fresh session should offer the same
   unscaled demands as before this fix (both scales floor at 1).
6. **HUD `peak` stat still updates** — `peakComputeServed` is untouched, just no longer feeds
   scaling.
