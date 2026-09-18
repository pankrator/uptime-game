// This game's concrete event map for event-bus.ts's generic EventBus<Events> — the domain
// events raised by tick-order systems that a genuinely independent listener (today: audio;
// nothing else yet) reacts to, without that system needing to import the listener directly. See
// .plans/event-bus.md for which cross-system calls moved here and which deliberately didn't.
//
// Payloads carry whatever id the emitting system already has in hand at the call site (never
// more) — cheap to include, and it's what makes an event actually useful to a listener instead
// of a content-free bell.
import { type EntityId } from './world';
import { type PurchasableId } from './game-data';

export interface GameEvents {
  'machine:installed': { machineId: EntityId; rackId: EntityId };
  'machine:repaired': { machineId: EntityId };
  'machine:decommissioned': { machineId: EntityId };
  'machine:failed': { machineId: EntityId };
  // Distinct from 'machine:thermal-tripped' below even though both currently map to the same
  // sound (see audio-events.ts) — a capacity brownout and an overheating trip are different
  // causes, and a future listener (a toast, a tutorial step) will care which one happened.
  'machine:browned-out': { machineId: EntityId };
  'machine:thermal-tripped': { machineId: EntityId; rackId: EntityId };
  'contract:completed': { workloadId: EntityId };
  'contract:missed': { workloadId: EntityId };
  // A purchase actually went through (shop.ts's buy() returned true) — a rejected click (can't
  // afford it) never fires this. tutorial.ts listens for this to advance the 'visit-shop' step
  // without shop.ts needing to import tutorial.ts directly (see .plans/event-bus.md).
  'shop:purchased': { facility: EntityId; purchasableId: PurchasableId };
}
