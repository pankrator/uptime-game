// The only place workload placement mutates. Systems and input both call into this module, so
// the `Workload.state` / `PlacedOn` / `ServerCapacity.free` invariant lives in one file. See
// .plans/workload-dispatch.md D1 and the "New module: src/ecs/dispatch.ts" section.
//
// Step 3: checkPlacement/placeWorkload/unplaceWorkload only. acceptOffer/declineOffer are added
// in step 5 once the Offer component exists.
import { type World, type EntityId } from './world';
import { placedOns, serverCapacities, powereds, workloads } from './components';
import { type TraitKey } from './game-data';
import { fits, shortfall } from './traits';

// Validity check, no mutation. Returns null if the workload fits on the server (which must
// also be online — a browned-out box cannot take work), or the blocking trait keys otherwise.
export function checkPlacement(
  world: World,
  workloadId: EntityId,
  serverId: EntityId,
): TraitKey[] | null {
  const workload = world.getComponent(workloads, workloadId);
  const capacity = world.getComponent(serverCapacities, serverId);
  const powered = world.getComponent(powereds, serverId);
  if (!workload || !capacity) return null;
  if (!powered?.online) return ['cpu', 'ramGb', 'storageGb']; // offline: nothing fits

  if (fits(workload.demands, capacity.free)) return null;
  return shortfall(workload.demands, capacity.free);
}

// Place (or move). Asserts checkPlacement passed — callers must check first; this function
// does not re-validate. Unplaces from any previous server first, so a move is a single call.
export function placeWorkload(world: World, workloadId: EntityId, serverId: EntityId): boolean {
  const workload = world.getComponent(workloads, workloadId);
  if (!workload) return false;

  if (world.getComponent(placedOns, workloadId)) {
    unplaceWorkload(world, workloadId);
  }

  world.addComponent(placedOns, workloadId, { serverId });
  workload.state = 'running';
  return true;
}

// Remove from its server; the workload returns to the tray still holding its deadline. No-op
// if it wasn't placed. Capacity.ts recomputes ServerCapacity.free next tick — this function
// does not touch it directly, keeping "who's placed where" and "how much room is left" apart.
export function unplaceWorkload(world: World, workloadId: EntityId): void {
  const workload = world.getComponent(workloads, workloadId);
  if (!world.getComponent(placedOns, workloadId)) return;

  world.removeComponent(placedOns, workloadId);
  if (workload) workload.state = 'pending';
}
