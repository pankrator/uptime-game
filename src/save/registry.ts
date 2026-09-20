import { type ComponentStore, type EntityId } from '../ecs/world';
import {
  positions,
  gridPositions,
  renderables,
  speeds,
  moveTargets,
  pathFollows,
  buildModes,
  roomTiers,
  inventories,
  wallets,
  reputations,
  powerCapacities,
  coolingCapacities,
  rackSlots,
  rackLoads,
  temperatures,
  thermalTrips,
  coolingUnits,
  machines,
  installedIns,
  powereds,
  conditions,
  faileds,
  maintenanceTasks,
  serverCapacities,
  utilizations,
  resourceWarnings,
  demandClocks,
  placedOns,
  recentlyUnplaceds,
  workloads,
  offers,
  activeModals,
  rackScrolls,
  shopTabs,
  offersPanelScrolls,
  jobsPanelScrolls,
  pendingDrops,
  dragStates,
  decommissionConfirms,
  acceptConfirms,
  rejectedDrops,
  tutorialProgresses,
  playerTags,
  facilityTags,
  floatingTexts,
  toasts,
} from '../ecs/components';

// `T = unknown` here (rather than a precise per-entry generic) trades some compile-time
// checking inside each entry's `remapRefs` body for being able to hold every component's entry
// in one flat array. The round-trip test (round-trip.test.ts) is what actually catches a wrong
// `remapRefs`, not the type checker.
export interface SaveComponentEntry<T = unknown> {
  // Stable id, independent of the store's TS export name — renaming `wallets` to
  // `facilityWallets` later must never change what's already sitting in someone's
  // localStorage, so this is hand-picked once here, not derived from the import.
  key: string;
  store: ComponentStore<T>;
  // Only components holding another entity's id need this (InstalledIn.rackId,
  // PlacedOn.serverId, MaintenanceTask.rackId + its nested job.machineId). Default: no refs,
  // value passes through unchanged.
  remapRefs?: (value: T, remap: (id: EntityId) => EntityId) => T;
}

// Typed constructor for one registry entry — lets TS infer T from `store` (and so properly
// type `value`/the return inside `remapRefs`) at each call site below. The cast on return is
// the one deliberate widening this file does: `SaveComponentEntry<Condition>` and
// `SaveComponentEntry<Workload>` have no assignability relationship TS will prove on its own
// (T sits in both a covariant and a contravariant position via `remapRefs`, so it's invariant),
// but every call site above is still fully checked against ITS OWN `store`'s type before that
// widening happens — only the "hold many different entries in one flat array" step is erased.
function entry<T>(
  key: string,
  store: ComponentStore<T>,
  remapRefs?: (value: T, remap: (id: EntityId) => EntityId) => T,
): SaveComponentEntry {
  return { key, store, remapRefs } as SaveComponentEntry;
}

// Every component that gets written into a save and restored on load; TRANSIENT_COMPONENTS
// below is the skip side. registry.test.ts asserts every ComponentStore-shaped export of
// components.ts appears in exactly one of the two lists — keep that invariant in mind before
// adding a component to only one of them by hand.
export const SAVE_COMPONENTS: SaveComponentEntry[] = [
  entry('position', positions),
  entry('gridPosition', gridPositions),
  entry('renderable', renderables),
  entry('speed', speeds),
  entry('roomTier', roomTiers),
  entry('inventory', inventories),
  entry('wallet', wallets),
  entry('reputation', reputations),
  entry('powerCapacity', powerCapacities),
  entry('coolingCapacity', coolingCapacities),
  entry('rackSlots', rackSlots),
  entry('temperature', temperatures),
  entry('thermalTrip', thermalTrips),
  entry('coolingUnit', coolingUnits),
  entry('machine', machines),
  entry('installedIn', installedIns, (v, remap) => ({ ...v, rackId: remap(v.rackId) })),
  entry('powered', powereds),
  entry('condition', conditions),
  entry('failed', faileds),
  entry('maintenanceTask', maintenanceTasks, (v, remap) => ({
    ...v,
    rackId: remap(v.rackId),
    job:
      v.job.kind === 'repair' || v.job.kind === 'decommission'
        ? { ...v.job, machineId: remap(v.job.machineId) }
        : v.job,
  })),
  entry('demandClock', demandClocks),
  // Facility-singleton hysteresis latch (owned solely by resource.ts) for the near-capacity
  // warning toast — same "integrated, not derived" reasoning as ThermalTrip/Condition above.
  // Left transient, a loaded game would never warn again (resourceWarnings is only ever
  // spawned once, in spawnFacility) until the next process restart, not just degrade quietly.
  entry('resourceWarning', resourceWarnings),
  entry('placedOn', placedOns, (v, remap) => ({ serverId: remap(v.serverId) })),
  entry('workload', workloads),
  entry('offer', offers),
  entry('tutorialProgress', tutorialProgresses),
  entry('playerTag', playerTags),
  entry('facilityTag', facilityTags),
];

// Components deliberately NOT saved — either a derived cache fully recomputed every tick
// (rackLoads/serverCapacities/utilizations), or session-local UI/gesture/effect state that's
// meaningless across a reload (everything else here).
export const TRANSIENT_COMPONENTS: ComponentStore<unknown>[] = [
  moveTargets,
  pathFollows,
  buildModes,
  rackLoads,
  serverCapacities,
  utilizations,
  // Which modal (rack panel/shop/offers/jobs) is open, if any — a session-local UI toggle, same
  // as every other component in this list.
  activeModals,
  rackScrolls,
  shopTabs,
  // Offers/jobs panel scroll — session-local UI state, same category as activeModals/RackScroll
  // above.
  offersPanelScrolls,
  jobsPanelScrolls,
  pendingDrops,
  dragStates,
  decommissionConfirms,
  acceptConfirms,
  rejectedDrops,
  // A short (seconds-scale) real-time grace window tied to wall-clock `expiresAtMs` — restoring
  // it across a save that might sit for days makes no sense; the window either instantly expires
  // or wrongly extends. Same reasoning as DecommissionConfirm/AcceptConfirm/RejectedDrop above.
  recentlyUnplaceds,
  // Presentation-only, wall-clock-timed visual effects (floating "+$N" text, toast banners) —
  // spawned fresh by whatever triggers them; nothing to restore.
  floatingTexts,
  toasts,
];
