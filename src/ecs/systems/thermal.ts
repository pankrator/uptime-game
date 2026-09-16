// Integrates per-rack Temperature from this tick's RackLoad.heatKw and delivered cooling
// (facility baseline + placed CRAC units), derives the throttle band, and trips/recovers racks
// that overheat. See .plans/thermal-and-cooling.md D1-D7 and Step 3.
import { type World, type EntityId } from '../world';
import {
  rackSlots,
  gridPositions,
  rackLoads,
  temperatures,
  thermalTrips,
  coolingUnits,
  machines,
  installedIns,
  powereds,
  coolingCapacities,
  demandClocks,
} from '../components';
import {
  BASELINE_COOLING_SHARE,
  TRIP_C,
  TRIP_RECOVER_C,
  BROWNOUT_COOLDOWN_SECONDS,
} from '../game-data';
import {
  coolingFalloff,
  targetTemperature,
  approachTemperature,
  throttleFactorFor,
} from '../thermal';
import { unplaceAllOn } from './resource';
import { type Audio } from '../../audio';
import { type System } from './system';

// Runs AFTER resource.ts and capacity.ts (needs this tick's RackLoad.heatKw, and a machine
// already offline from a brownout must not also be generating heat) and BEFORE workload-run.ts
// (which applies Temperature.throttleFactor to pay/progress). See the ordering comment in
// main.ts.
export function createThermalSystem(world: World, facility: EntityId, audio: Audio): System {
  return {
    update(deltaSeconds: number) {
      const coolingCapacity = world.getComponent(coolingCapacities, facility);
      // D5: a flat baseline applied to every rack regardless of position, not divided across
      // racks — building ventilation, not something the player has to plan around early on.
      const baselineKw = (coolingCapacity?.kw ?? 0) * BASELINE_COOLING_SHARE;
      const elapsedSeconds = world.getComponent(demandClocks, facility)?.elapsedSeconds ?? 0;

      const cracIds = world.query(coolingUnits, gridPositions);

      // Bucket installed machines by rack once, rather than re-querying/filtering per rack —
      // same pattern as capacity.ts. O(racks * cracs + machines) per tick, trivial at this
      // game's scale (tens of racks, a handful of CRACs) — no spatial index needed.
      const machinesByRack = new Map<EntityId, EntityId[]>();
      for (const machineId of world.query(machines, installedIns, powereds)) {
        const rackId = world.getComponent(installedIns, machineId)!.rackId;
        const bucket = machinesByRack.get(rackId);
        if (bucket) bucket.push(machineId);
        else machinesByRack.set(rackId, [machineId]);
      }

      for (const rackId of world.query(rackSlots, gridPositions, temperatures)) {
        const grid = world.getComponent(gridPositions, rackId)!;
        const temperature = world.getComponent(temperatures, rackId)!;
        const load = world.getComponent(rackLoads, rackId) ?? {
          powerKw: 0,
          heatKw: 0,
          serverCount: 0,
        };

        let delivered = baselineKw;
        for (const cracId of cracIds) {
          const crac = world.getComponent(coolingUnits, cracId)!;
          const cracGrid = world.getComponent(gridPositions, cracId)!;
          const distance = Math.hypot(cracGrid.gridX - grid.gridX, cracGrid.gridY - grid.gridY);
          delivered += crac.kwOutput * coolingFalloff(distance, crac.radiusCells);
        }

        const target = targetTemperature(load.heatKw, delivered);
        temperature.celsius = approachTemperature(temperature.celsius, target, deltaSeconds);
        temperature.throttleFactor = throttleFactorFor(temperature.celsius);

        const tripped = world.getComponent(thermalTrips, rackId) !== undefined;
        if (!tripped && temperature.celsius >= TRIP_C) {
          world.addComponent(thermalTrips, rackId, { trippedAt: elapsedSeconds });
          for (const machineId of machinesByRack.get(rackId) ?? []) {
            const powered = world.getComponent(powereds, machineId)!;
            if (!powered.online) continue;
            powered.online = false;
            powered.offlineCooldown = BROWNOUT_COOLDOWN_SECONDS;
            unplaceAllOn(world, machineId);
            audio.play('brownout');
          }
        } else if (tripped && temperature.celsius <= TRIP_RECOVER_C) {
          // Hysteresis (D3/Step 3): clear a few degrees below THROTTLE_C, not right at TRIP_C —
          // otherwise a rack sitting on the boundary flickers online/offline every tick.
          // resource.ts's normal recovery path (candidateIds filter + offlineCooldown) brings
          // the rack's machines back online on a later tick; this system only ever forces
          // offline, never forces online (D7).
          world.removeComponent(thermalTrips, rackId);
        }
      }
    },
  };
}
