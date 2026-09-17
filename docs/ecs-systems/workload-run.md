# workload-run

`src/ecs/systems/workload-run.ts` — `createWorkloadRunSystem(world, facility, audio)`

## Purpose

Ticks every live `Workload` each frame: pays out while running, advances work/deadline
timers, and resolves completion or deadline miss.

## Reads / writes

- Reads: `placedOns`, `powereds` (whether the placement server is online),
  `WORKLOAD_ARCHETYPES[workload.archetypeId].deadlineSeconds` (the per-cycle deadline reset)
- Writes: `Workload.deadlineRemainingSeconds` / `workRemainingSeconds` /
  `repeatCount`; `Wallet.money`; `Reputation.value`; `DemandClock.contractsServed` /
  `peakComputeServed`; removes `PlacedOn` and destroys the workload entity on final
  completion or deadline miss

## Algorithm (per workload, per tick)

1. `deadlineRemainingSeconds -= dt` **always** — whether sitting unplaced in the tray or
   running. Sitting idle burns the player's own margin; there's no separate start
   deadline to track (see D2 in `.plans/workload-dispatch.md`).
2. If placed **and** its server is online: pay `payPerSecond * dt` and decrement
   `workRemainingSeconds`.
3. Completion is checked **before** deadline, so a job finishing the same tick its
   deadline expires counts as a success, not a miss.
4. Completion: `+REPUTATION_ON_COMPLETION`, updates `peakComputeServed` from the
   workload's own `demands.cpu` (one workload occupies exactly one server, so no
   cross-machine fold is needed), plays `contractCompleted` (see [audio](./audio.md)), and
   spawns a rising `+$N` (`effects.ts`'s `spawnFloatingText`) at the rack's grid position —
   looked up via `placement.serverId` while `placement` is still valid, before any unplace
   below (F7). Then, per `.plans/contract-variety.md` D2:
   - If `repeatCount > 0`: decrement it, reset `workRemainingSeconds` to `workSeconds` and
     `deadlineRemainingSeconds` to the archetype's `deadlineSeconds`, and leave it placed —
     it keeps running on the same server for another cycle. `contractsServed` is **not**
     incremented here (see below).
   - Otherwise (final cycle, or a one-shot contract): `contractsServed += 1`, unplace +
     destroy.
5. Deadline miss: `+REPUTATION_ON_MISSED_DEADLINE` (negative), `Wallet.money -=
   workload.penaltyOnMiss` (D1 — only accepted work is penalized; an expired *offer* never
   becomes a `Workload` and so never reaches this system), unplace + destroy, plays
   `contractMissed`, and spawns a red banner toast (`effects.ts`'s `spawnToast`) naming the
   contract and its cost (F7).

`contractsServed` counts **contracts**, not cycles — a 5-cycle recurring contract increments
it once, on its last cycle, not five times. `peakComputeServed` updates every cycle since the
capacity really was served each time. See the step-2 note in `.plans/contract-variety.md` for
why these two are deliberately split.

## Notes

- **Must run after `capacity`** (`main.ts` order) — otherwise it could pay out against a
  placement a same-tick brownout already invalidated.
- Reputation is clamped to `[0, 100]` via `clampReputation` (`game-data.ts`), shared with
  `dispatch.ts`'s `declineOffer` so every reputation write goes through the same clamp.
