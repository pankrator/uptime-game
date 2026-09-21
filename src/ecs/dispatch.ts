// The only place workload placement mutates. Systems and input both call into this module, so
// the `Workload.state` / `PlacedOn` / `ServerCapacity.free` invariant lives in one file.
import { type World, type EntityId } from './world';
import {
  placedOns,
  serverCapacities,
  powereds,
  workloads,
  offers,
  reputations,
  wallets,
  type Workload,
} from './components';
import {
  type TraitKey,
  TRAIT_KEYS,
  REPUTATION_ON_DECLINE,
  ABANDON_REPUTATION_COST,
  ABANDON_PENALTY_FRACTION,
  clampReputation,
} from './game-data';
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
  if (!powered?.online) return [...TRAIT_KEYS]; // offline: nothing fits

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

// Every workload currently placed on `serverId` — a server hosts as many as its traits allow,
// so this is a plural lookup.
export function workloadsOn(world: World, serverId: EntityId): EntityId[] {
  return world
    .query(placedOns)
    .filter((workloadId) => world.getComponent(placedOns, workloadId)!.serverId === serverId);
}

// Unplace everything on `serverId`, returning what was moved. The workloads go back to the tray
// still holding their deadlines — a visible, recoverable setback rather than silent progress
// loss — and, critically, nothing is left pointing at a server that may be about to be
// destroyed. Callers layer their own follow-up on the returned ids (resource.ts tags them for
// its restore grace window; a decommission wants no such tag, since that server is not coming
// back).
export function unplaceAllOn(world: World, serverId: EntityId): EntityId[] {
  const workloadIds = workloadsOn(world, serverId);
  for (const workloadId of workloadIds) unplaceWorkload(world, workloadId);
  return workloadIds;
}

// Remove from its server; the workload returns to the tray still holding its deadline. No-op
// if it wasn't placed. Capacity.ts recomputes ServerCapacity.free next tick — this function
// does not touch it directly, keeping "who's placed where" and "how much room is left" apart.
export function unplaceWorkload(world: World, workloadId: EntityId): void {
  const workload = world.getComponent(workloads, workloadId);
  if (!world.getComponent(placedOns, workloadId)) return;

  world.removeComponent(placedOns, workloadId);
  if (workload) workload.state = 'accepted';
}

// Turns an Offer into a Workload entity (accepted, not yet placed) and destroys the offer.
// Offer.secondsRemaining is NOT carried over — deadlineRemainingSeconds starts fresh from
// deadlineSeconds the instant a contract is accepted.
export function acceptOffer(world: World, offerId: EntityId): EntityId {
  const offer = world.getComponent(offers, offerId)!;
  const id = world.createEntity();
  const workload: Workload = {
    archetypeId: offer.archetypeId,
    demands: offer.demands,
    workSeconds: offer.workSeconds,
    workRemainingSeconds: offer.workSeconds,
    payPerSecond: offer.payPerSecond,
    deadlineRemainingSeconds: offer.deadlineSeconds,
    state: 'accepted',
    penaltyOnMiss: offer.penaltyOnMiss,
    repeatCount: offer.repeatCount,
    repeatTotal: offer.repeatTotal,
  };
  world.addComponent(workloads, id, workload);
  world.destroyEntity(offerId);
  return id;
}

// A small, flat reputation cost (REPUTATION_ON_DECLINE) — enough that cherry-picking forever
// isn't free, small enough that declining a genuinely bad offer (no server fits it, or a
// recurring contract you don't have room to commit to) is still clearly the right call next to
// accepting and eating penaltyOnMiss. facility is only needed to look up Reputation — this
// function still owns no other state.
export function declineOffer(world: World, facility: EntityId, offerId: EntityId): void {
  const reputation = world.getComponent(reputations, facility);
  if (reputation) reputation.value = clampReputation(reputation.value + REPUTATION_ON_DECLINE);
  world.destroyEntity(offerId);
}

// Cutting losses on an accepted-but-doomed contract costs more than a decline (already
// committed capacity/attention a decline never spends) but strictly less than letting it rot
// into a full miss (REPUTATION_ON_MISSED_DEADLINE plus 100% of penaltyOnMiss), so it's always
// the better move once a contract is clearly unservable. Works whether the workload is sitting
// in the tray or currently placed — unplaces first so ServerCapacity.free recomputes next tick
// same as any other unplace.
export function abandonWorkload(world: World, facility: EntityId, workloadId: EntityId): void {
  const workload = world.getComponent(workloads, workloadId);
  if (!workload) return;

  const reputation = world.getComponent(reputations, facility);
  if (reputation) reputation.value = clampReputation(reputation.value + ABANDON_REPUTATION_COST);

  const wallet = world.getComponent(wallets, facility);
  if (wallet) wallet.money -= workload.penaltyOnMiss * ABANDON_PENALTY_FRACTION;

  if (world.getComponent(placedOns, workloadId)) {
    world.removeComponent(placedOns, workloadId);
  }
  world.destroyEntity(workloadId);
}
