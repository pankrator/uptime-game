import { type World, type EntityId } from '../world';
import {
  machines,
  installedIns,
  powereds,
  placedOns,
  workloads,
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
// Reads placement off `PlacedOn` (on the workload — see D1, one workload per server, a server
// can host several workloads until its traits exhaust).
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

      // Sum of demands for every workload PlacedOn a given server — a server can host several
      // workloads at once (D1), so this is a fold, not a single lookup.
      const usedByServer = new Map<EntityId, ReturnType<typeof zeroTraits>>();
      for (const workloadId of world.query(placedOns)) {
        const serverId = world.getComponent(placedOns, workloadId)!.serverId;
        const workload = world.getComponent(workloads, workloadId);
        if (!workload) continue;
        const current = usedByServer.get(serverId) ?? zeroTraits();
        usedByServer.set(serverId, addTraits(current, workload.demands));
      }

      for (const machineId of world.query(machines, installedIns, powereds)) {
        const machine = world.getComponent(machines, machineId)!;
        const installedIn = world.getComponent(installedIns, machineId)!;
        const powered = world.getComponent(powereds, machineId)!;
        const tier = MACHINE_TIERS[machine.tierId];

        // Offline servers report their own `total` (so the panel shows "this box is dark",
        // not "this box vanished") but contribute zero to facility totals and zero rack draw.
        const used = usedByServer.get(machineId) ?? zeroTraits();
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
