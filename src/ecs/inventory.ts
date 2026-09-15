import { type World, type EntityId } from './world';
import { inventories } from './components';
import { type PurchasableId } from './game-data';

// Pure functions over Inventory (D5) — both the systems that buy (shop.ts) and place
// (input.ts) go through these rather than touching `counts` directly.

export function countOf(world: World, facility: EntityId, id: PurchasableId): number {
  const inventory = world.getComponent(inventories, facility);
  return inventory?.counts[id] ?? 0;
}

export function hasInInventory(world: World, facility: EntityId, id: PurchasableId): boolean {
  return countOf(world, facility, id) > 0;
}

export function addToInventory(world: World, facility: EntityId, id: PurchasableId, amount = 1): void {
  const inventory = world.getComponent(inventories, facility);
  if (!inventory) return;
  inventory.counts[id] = (inventory.counts[id] ?? 0) + amount;
}

// Returns false (no-op) if there's nothing to take — callers should check hasInInventory (or
// treat a false return as "can't place") before committing to a placement.
export function takeFromInventory(world: World, facility: EntityId, id: PurchasableId, amount = 1): boolean {
  const inventory = world.getComponent(inventories, facility);
  const current = inventory?.counts[id] ?? 0;
  if (!inventory || current < amount) return false;
  inventory.counts[id] = current - amount;
  return true;
}
