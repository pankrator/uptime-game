# thermal

`src/ecs/systems/thermal.ts` — `createThermalSystem(world, facility, audio)`
Pure math lives in `src/ecs/thermal.ts` (no ECS dependency, independently testable).

## Purpose

Integrates each rack's `Temperature` from this tick's `RackLoad.heatKw` and the cooling
delivered to that rack, derives the throttle factor, and trips/recovers racks that
overheat. See `.plans/thermal-and-cooling.md` D1–D7.

## Reads / writes

- Reads: `rackSlots`, `gridPositions`, `rackLoads`, `coolingUnits`, `machines`,
  `installedIns`, `powereds`, `demandClocks`
- Writes: `Temperature.celsius` / `Temperature.throttleFactor`; adds/removes the
  `ThermalTrip` marker; on trip, sets `Powered.online = false` +
  `offlineCooldown = BROWNOUT_COOLDOWN_SECONDS` and calls `unplaceAllOn` (reused from
  `resource.ts`, not reimplemented)

## Temperature is local

A rack's temperature depends on three things and nothing else:

```
delivered = BASELINE_COOLING_KW + Σ over CRACs of kwOutput * coolingFalloff(gridDistance, radiusCells)
target    = max(SUPPLY_AIR_C, AMBIENT_C + heatKw * HEAT_TO_DEGREES - delivered * COOLING_TO_DEGREES)
celsius  += (target - celsius) * THERMAL_RESPONSE * dt
```

1. `BASELINE_COOLING_KW` — flat building ventilation, a constant, same for every rack.
2. CRAC units in range — linear falloff to zero at `radiusCells` (legible: the player can
   see the ring). An adjacent CRAC at grid distance 1 with radius 3 delivers ⅔ of its
   `kwOutput`, i.e. 2 kW of 3, **not** the full 3.
3. `RackLoad.heatKw` — that rack's own machines plus the `coolingBonusKw` of the workloads
   running on them, from `capacity.ts`.

**The facility's `CoolingCapacity` is deliberately absent.** That is a facility-wide budget
for how much work the datacenter can run (see [resource](./resource.md)); it does not cool
individual racks. Deriving a per-rack term from it is a unit error that makes heat
unreachable — `.plans/thermal-and-cooling.md` D5 has the full post-mortem.

`SUPPLY_AIR_C` floors the target because the subtraction is otherwise unbounded: surplus
cooling would walk a rack arbitrarily far below zero. Over-cooling stops paying off there
rather than continuing forever.

## Bands

| Band | Condition | Effect |
| --- | --- | --- |
| Normal | `< THROTTLE_C` | `throttleFactor` 1 |
| Throttling | `THROTTLE_C … TRIP_C` | `throttleFactor` ramps 1 → 0; `workload-run` scales both progress and pay by it |
| Tripped | `≥ TRIP_C` | `ThermalTrip` added; every machine in the rack forced offline, its workloads unplaced |

A trip clears only at `TRIP_RECOVER_C` (5 °C below `THROTTLE_C`), not at `TRIP_C` —
hysteresis, or a rack on the boundary flickers every tick.

## Notes

- **Ordering** (`main.ts`): runs after `resource` (a machine already browned out must not
  also generate heat) and after `capacity` (needs this tick's `RackLoad.heatKw`); runs
  before `wear` (heat multiplies wear accrual) and before `workload-run` (which applies
  `throttleFactor`).
- **This system may only force machines offline, never online** (D7). `resource.ts` is the
  sole writer of `Powered.online`; it reads `ThermalTrip` as a veto when deciding recovery
  candidates. Do not set `online = true` here.
- `Temperature` is the one component that is *not* a recompute-every-tick cache — it
  accumulates across ticks and is owned solely by this system (see the comment on the
  component in `components.ts`).
- Tuning: `HEAT_TO_DEGREES` sets how steep the curve is and therefore how wide the throttle
  band is in kW — at 6 °C/kW the 20 °C band spans 3.3 kW of heat. `BASELINE_COOLING_KW` sets
  how much hardware a rack carries before it needs a CRAC at all. `CRAC_UNIT.kwOutput` /
  `radiusCells` set how much a CRAC buys and how tight placement has to be.
