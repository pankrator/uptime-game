# workload-run

`src/ecs/systems/workload-run.ts` — `createWorkloadRunSystem(world, facility, audio)`

## Purpose

Ticks every live `Workload` each frame: pays out while running, advances work/deadline
timers, and resolves completion or deadline miss.

## Reads / writes

- Reads: `placedOns`, `powereds` (whether the placement server is online)
- Writes: `Workload.deadlineRemainingSeconds` / `workRemainingSeconds`; `Wallet.money`;
  `Reputation.value`; `DemandClock.contractsServed` / `peakComputeServed`; removes
  `PlacedOn` and destroys the workload entity on completion or deadline miss

## Algorithm (per workload, per tick)

1. `deadlineRemainingSeconds -= dt` **always** — whether sitting unplaced in the tray or
   running. Sitting idle burns the player's own margin; there's no separate start
   deadline to track (see D2 in `.plans/workload-dispatch.md`).
2. If placed **and** its server is online: pay `payPerSecond * dt` and decrement
   `workRemainingSeconds`.
3. Completion is checked **before** deadline, so a job finishing the same tick its
   deadline expires counts as a success, not a miss.
4. Completion: `+REPUTATION_ON_COMPLETION`, `contractsServed += 1`, updates
   `peakComputeServed` from the workload's own `demands.cpu` (one workload occupies
   exactly one server, so no cross-machine fold is needed), unplace + destroy, plays
   `contractCompleted` (see [audio](./audio.md)).
5. Deadline miss: `+REPUTATION_ON_MISSED_DEADLINE` (negative), unplace + destroy, plays
   `contractMissed`.

## Notes

- **Must run after `capacity`** (`main.ts` order) — otherwise it could pay out against a
  placement a same-tick brownout already invalidated.
- Reputation is clamped to `[0, 100]` via a local `clampReputation` helper.
