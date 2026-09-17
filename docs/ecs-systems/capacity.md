# capacity

`src/ecs/systems/capacity.ts` — `createCapacitySystem(world, facility)`

## Purpose

Fully recomputes, every tick, the derived capacity caches other systems and the UI read
directly: each server's free `Traits`, each rack's power/heat/server-count rollup
(`RackLoad`), and the facility's total/free `Traits` (`Utilization.traitsTotal/traitsFree`).

## Reads / writes

- Reads: `machines`, `installedIns`, `powereds`, `placedOns`, `workloads`, `rackSlots`,
  `gridPositions`
- Writes: `ServerCapacity` (per machine), `RackLoad` (per rack), `Utilization.traitsTotal`
  / `traitsFree`

## Algorithm

1. Fold every placed workload's `demands` onto its server (`usedByServer`) — a server can
   host several workloads at once, so this is a sum, not a single lookup.
2. For every installed machine: `ServerCapacity.free = tier.traits - used`. Offline
   machines still get a `ServerCapacity` (so the rack panel shows "this box is dark, not
   vanished") but contribute nothing to rack/facility totals.
3. Roll online machines up into their rack's `RackLoad` (power, heat, server count) and
   into the facility's `traitsTotal`/`traitsFree`. `RackLoad.powerKw`/`heatKw` come
   straight from `resource.ts`'s exported `drawFor(world, machineId)` — not a second,
   locally-duplicated calculation — so the idle-power discount (F5) and the cooling-bonus
   formula can never drift out of sync between the billed draw and the rack panel's own
   readout.

## Notes

- **Must run after `resource`** (which decides `Powered.online`) **and before
  `workload-run`** (`main.ts` order) — otherwise workload payout would run against
  stale free-capacity from before this tick's brownout decisions.
- Purely a derived cache: nothing outside this system should hand-edit `ServerCapacity`,
  `RackLoad`, or the `traits*` fields of `Utilization`.
