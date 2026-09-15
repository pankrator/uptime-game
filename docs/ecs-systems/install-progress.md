# install-progress

`src/ecs/systems/install-progress.ts` — `createInstallProgressSystem(world, controlled, facility)`

## Purpose

Drives the "walk to rack, then spend N seconds installing" flow for a machine the
player has already paid for and is carrying as an `InstallTask`. Spawns the actual
machine entity on completion.

## Reads / writes

- Reads: `InstallTask` on `controlled`; `Position`/`GridPosition` for arrival distance;
  `RackSlots`, `InstalledIn` (occupied-slot lookup)
- Writes: `InstallTask.arrived`, `InstallTask.secondsRemaining`; removes `InstallTask` on
  completion or refund; calls `spawnMachine` (`src/entities.ts`); refunds to `Wallet` if
  the target slot/rack is gone

## Notes

- Arrival uses the same reach-radius pattern as `rack-panel`'s `DISPATCH_REACH_PX`
  (`GRID_CELL_SIZE * 1.2`), duplicated locally as `INSTALL_REACH_PX` rather than shared —
  check both if that radius ever needs to change.
- If the target rack was destroyed or the target slot filled while walking, re-resolves
  to the lowest free slot; if none exists, refunds the machine's cost directly to the
  wallet (not inventory) since the task is abandoned outright, not player-cancelled.
- Cancellation (any click while a task is active, or Escape) is handled by `input.ts`'s
  `cancelInstallTask`, which refunds to inventory instead — see [input](./input.md).
