import { type World, type EntityId } from '../world';
import {
  machines,
  installedIns,
  powereds,
  assignments,
  rackSlots,
  gridPositions,
  serverCapacities,
  rackLoads,
  utilizations,
} from '../components';
import { MACHINE_TIERS } from '../game-data';
import { zeroTraits, addTraits, subtractTraits } from '../traits';
import { type System } from './system';

// Recomputes, every tick, from scratch — same derived-cache discipline as resource.ts:
// ServerCapacity.free per machine, RackLoad (power/heat/server count) per rack, and the
// facility's Utilization.traitsTotal/traitsFree.
//
// Step 2 of .plans/workload-dispatch.md: still reads placement off `Assignment` (today's
// one-workload-many-machines model). Step 3 switches this to `PlacedOn` once one-workload-
// one-server placement lands; the shape of this system does not change, only what it reads
// to find "what's using this server".
//
// Runs AFTER resource.ts (which decides Powered.online) and BEFORE workload-run.ts — running
// workload-run against stale free-capacity would pay out for placements a brownout already
// invalidated this frame.
export function createCapacitySystem(world: World, facility: EntityId): System {
  return {
    update() {
      const utilization = world.getComponent(utilizations, facility);
      if (!utilization) return;

      // Per-server free capacity, and accumulate each rack's power/heat as we go.
      const rackLoadAccum = new Map<EntityId, { powerKw: number; heatKw: number; serverCount: number }>();

      let traitsTotal = zeroTraits();
      let traitsFree = zeroTraits();

      for (const machineId of world.query(machines, installedIns, powereds)) {
        const machine = world.getComponent(machines, machineId)!;
        const installedIn = world.getComponent(installedIns, machineId)!;
        const powered = world.getComponent(powereds, machineId)!;
        const tier = MACHINE_TIERS[machine.tierId];

        // Offline servers report their own `total` (so the panel shows "this box is dark",
        // not "this box vanished") but contribute zero to facility totals and zero rack draw.
        const assignment = world.getComponent(assignments, machineId);
        const used = assignment ? { cpu: assignment.compute, ramGb: 0, storageGb: 0 } : zeroTraits();
        const free = subtractTraits(tier.traits, used);

        world.addComponent(serverCapacities, machineId, { total: tier.traits, free });

        if (!powered.online) continue;

        traitsTotal = addTraits(traitsTotal, tier.traits);
        traitsFree = addTraits(traitsFree, free);

        const rackAccum = rackLoadAccum.get(installedIn.rackId) ?? {
          powerKw: 0,
          heatKw: 0,
          serverCount: 0,
        };
        rackAccum.powerKw += tier.powerKw;
        // Heat === cooling draw for now; kept as a separate field on RackLoad so local heat
        // accumulation later doesn't need a data-model change.
        rackAccum.heatKw += tier.coolingKw;
        rackAccum.serverCount += 1;
        rackLoadAccum.set(installedIn.rackId, rackAccum);
      }

      for (const rackId of world.query(rackSlots, gridPositions)) {
        const accum = rackLoadAccum.get(rackId) ?? { powerKw: 0, heatKw: 0, serverCount: 0 };
        world.addComponent(rackLoads, rackId, accum);
      }

      utilization.traitsTotal = traitsTotal;
      utilization.traitsFree = traitsFree;
    },
  };
}
