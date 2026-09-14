// Temporary one-workload-one-server auto-placer — keeps the game running while the manual
// drag-and-drop rack panel doesn't exist yet (that lands in step 8). This system, and the
// auto-placement behavior entirely, is DELETED in step 8 once dispatch becomes a player action.
// See .plans/workload-dispatch.md D1 and step 3/8.
import { type World, type EntityId } from '../world';
import { machines, powereds, workloads, installedIns, serverCapacities } from '../components';
import { type Traits } from '../game-data';
import { fits, subtractTraits } from '../traits';
import { placeWorkload } from '../dispatch';
import { type System } from './system';

export function createWorkloadAssignSystem(world: World): System {
  return {
    update() {
      const pendingWorkloadIds = world
        .query(workloads)
        .filter((id) => world.getComponent(workloads, id)!.state === 'accepted')
        .sort((a, b) => a - b);

      if (pendingWorkloadIds.length === 0) return;

      const serverIds = world
        .query(machines, installedIns, powereds, serverCapacities)
        .filter((id) => world.getComponent(powereds, id)!.online);

      // ServerCapacity.free is only recomputed once per tick by capacity.ts, so placing two
      // workloads on the same server within this same loop needs a local running tally —
      // otherwise both could be checked against the same stale `free` and double-book it.
      const remainingFree = new Map<EntityId, Traits>();
      for (const serverId of serverIds) {
        remainingFree.set(serverId, world.getComponent(serverCapacities, serverId)!.free);
      }

      for (const workloadId of pendingWorkloadIds) {
        const workload = world.getComponent(workloads, workloadId)!;

        // Smallest-fit-first: prefer the server with the least free CPU that still fits the
        // workload, so a big workload doesn't get wedged onto (and waste) a large empty server
        // when a smaller one would do — an approximation of the old greedy packing, now that a
        // workload must fit a single server whole (D1) rather than spanning several.
        const candidates = serverIds
          .filter((serverId) => fits(workload.demands, remainingFree.get(serverId)!))
          .sort((a, b) => remainingFree.get(a)!.cpu - remainingFree.get(b)!.cpu);

        const bestServerId = candidates[0];
        if (bestServerId === undefined) continue;

        placeWorkload(world, workloadId, bestServerId);
        remainingFree.set(bestServerId, subtractTraits(remainingFree.get(bestServerId)!, workload.demands));
      }
    },
  };
}
