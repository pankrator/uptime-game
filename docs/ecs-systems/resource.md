# resource

`src/ecs/systems/resource.ts` — `createResourceSystem(world, facility, audio)`

## Purpose

Decides, every tick, which installed machines are online vs. browned-out given facility
power/cooling capacity, and rolls up total power/cooling draw and compute headroom onto
the facility's `Utilization`. This is the authority on `Powered.online` — no other system
flips that flag.

## Reads / writes

- Reads: `machines`, `installedIns`, `powereds`, `placedOns`, `workloads`,
  `powerCapacities`, `coolingCapacities`
- Writes: `Powered.online`, `Powered.offlineCooldown`; `Utilization.powerDrawKw` /
  `coolingDrawKw` / `computeTotal` / `computeFree`; calls `unplaceWorkload` (via
  `dispatch.ts`) for every workload on a machine that goes offline

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
   progress loss. Plays `brownout` per machine that goes offline this tick (see
   [audio](./audio.md)).
5. Recompute draw/compute totals from the final online set.

## Notes

- **Must run before `capacity`** (`main.ts` order) — `capacity.ts` derives free capacity
  from `Powered.online`, so running it first would use last tick's online set.
- "Newest-first" browning-out is a deliberate, simple ordering rule (not cost/priority
  based) — see `selectMachinesToBrownOut`'s docstring if changing this policy.
- A workload's cooling contribution (`WORKLOAD_ARCHETYPES[...].coolingBonusKw`) is added
  on top of a machine's idle draw in `drawFor` — `capacity.ts`'s `RackLoad.heatKw`
  mirrors this exact calculation, so the two must be kept in sync if either changes.
- **`CoolingCapacity` means "how much work the datacenter can run", nothing else.** It is a
  brownout cap here and it is *not* read by [thermal](./thermal.md) — rack temperature is
  local (flat baseline + CRAC units in range + that rack's own heat). Do not reintroduce a
  per-rack cooling term derived from it: it is a facility-wide total, so spreading it over
  racks hands every rack the whole floor's cooling. See `.plans/thermal-and-cooling.md` D5.
- Power and cooling are not redundant budgets. Every machine tier draws more power than
  cooling at idle, and `drawFor` holds `powerKw` fixed under load while summing workload
  `coolingBonusKw` — so power caps *fleet size* and cooling caps *workload mix*. Cooling only
  becomes the binding constraint once the player runs `render` (+0.8 kW) or `training`
  (+2.2 kW) contracts.
