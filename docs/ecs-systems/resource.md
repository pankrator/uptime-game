# resource

`src/ecs/systems/resource.ts` — `createResourceSystem(world, facility, audio)`

## Purpose

Decides, every tick, which installed machines are online vs. browned-out given facility
power/cooling capacity, and rolls up total power/cooling draw and compute headroom onto
the facility's `Utilization`. This is the authority on `Powered.online` — no other system
flips that flag.

## Reads / writes

- Reads: `machines`, `installedIns`, `powereds`, `placedOns`, `workloads`,
  `powerCapacities`, `coolingCapacities`, `recentlyUnplaceds`
- Writes: `Powered.online`, `Powered.offlineCooldown`; `Utilization.powerDrawKw` /
  `coolingDrawKw` / `computeTotal` / `computeFree`; `ResourceWarning.powerNearLimit` /
  `coolingNearLimit`; tags/consumes `RecentlyUnplaced`; calls `unplaceWorkload` (via
  `dispatch.ts`) for every workload on a machine that goes offline, and `checkPlacement`/
  `placeWorkload` to auto-restore a tagged workload when its server comes back online

## Algorithm

1. Tick down `offlineCooldown` for any offline machine.
2. Candidates for being online = already-online machines, plus offline machines whose
   cooldown has elapsed.
3. `selectMachinesToBrownOut` (pure, exported for testing) sorts candidates
   newest-first (descending entity id) and takes machines offline one at a time until
   both power and cooling draw fit within capacity.
4. Any machine transitioning online→offline gets `BROWNOUT_COOLDOWN_SECONDS` cooldown and
   has every workload placed on it unplaced (`unplaceAllOn`) — they return to the tray
   still holding their deadline, a visible/recoverable setback rather than silent
   progress loss, AND tagged `RecentlyUnplaced` (the server they came from, plus a
   `BROWNOUT_RESTORE_GRACE_SECONDS` expiry). Plays `brownout` per machine that goes
   offline this tick (see [audio](./audio.md)).
5. Any machine transitioning offline→online checks for a matching, unexpired
   `RecentlyUnplaced` tag and re-places that workload on the same server if it still fits
   (`restoreRecentlyUnplaced`) — see .plans/playtest-findings.md F4.
6. Recompute draw/compute totals from the final online set.
7. Compare power/cooling draw against capacity; the first tick either ratio crosses
   `RESOURCE_WARNING_FRACTION` fires a one-shot toast (`effects.ts`'s `spawnToast`) via
   `ResourceWarning`, before anything actually browns out. Clears (can fire again) once
   the ratio falls back under `RESOURCE_WARNING_CLEAR_FRACTION` (hysteresis).

## Notes

- **Must run before `capacity`** (`main.ts` order) — `capacity.ts` derives free capacity
  from `Powered.online`, so running it first would use last tick's online set.
- "Newest-first" browning-out is a deliberate, simple ordering rule (not cost/priority
  based) — see `selectMachinesToBrownOut`'s docstring if changing this policy.
- `drawFor` (exported) is the single source of a machine's power/cooling draw: a
  workload's cooling contribution (`WORKLOAD_ARCHETYPES[...].coolingBonusKw`) is added on
  top of the machine's base draw, and an ONLINE machine with nothing placed on it draws
  only `IDLE_POWER_FRACTION` of its full power/cooling (F5). `capacity.ts`'s
  `RackLoad.powerKw`/`heatKw` call this exact function rather than duplicating the math,
  so the rack panel's readout and the billed draw can never disagree.
