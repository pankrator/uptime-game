// Shop lifecycle: proximity open/close (mirrors rack-panel.ts's arrival pattern, but simpler —
// no travel state to track, just in-range or not) and buy(), which applies D6's three
// purchasable kinds. See .plans/facility-shop-inventory.md Step 5.
import { type World, type EntityId } from '../world';
import { positions, gridToWorld, shopOpens, wallets, powerCapacities, coolingCapacities, roomTiers } from '../components';
import {
  PURCHASABLES,
  ROOM_TIERS,
  POWER_UPGRADE_KW,
  COOLING_UPGRADE_KW,
  type PurchasableId,
} from '../game-data';
import { SHOP_DOOR } from '../world-map';
import { addToInventory } from '../inventory';
import { type System } from './system';

const SHOP_REACH_PX = 80; // ~2 grid cells — close enough to the shop door to browse

// Set when the player dismisses the panel with Escape while still in range (input.ts) — without
// this, proximity would reopen it the very next frame. Cleared once they leave range, so
// walking away and back re-opens it normally.
let dismissedWhileInRange = false;

export function dismissShop(): void {
  dismissedWhileInRange = true;
}

// Shared UI state: which category tab is selected. Module-level (not per-entity) since there's
// only ever one player and one shop panel — input.ts (click handling) and render.ts (drawing)
// both need to read/write the same current tab.
export const shopTab = { current: PURCHASABLES[0].category };

export function shopCategories(): string[] {
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const purchasable of PURCHASABLES) {
    if (!seen.has(purchasable.category)) {
      seen.add(purchasable.category);
      categories.push(purchasable.category);
    }
  }
  return categories;
}

export function shopCatalogForTab(category: string) {
  return PURCHASABLES.filter((p) => p.category === category);
}

function canAfford(world: World, facility: EntityId, cost: number): boolean {
  const wallet = world.getComponent(wallets, facility);
  if (!wallet) return false;
  return Math.floor(wallet.money) >= cost;
}

// Applies a purchase's effect per its kind (D6): 'stock' → inventory +1, 'instant' → capacity
// applied now, 'room' → room tier advances now. Rejected (no-op) if the wallet can't cover it.
export function buy(world: World, facility: EntityId, purchasableId: PurchasableId): void {
  const purchasable = PURCHASABLES.find((p) => p.id === purchasableId);
  if (!purchasable) return;
  if (!canAfford(world, facility, purchasable.cost)) return;

  const wallet = world.getComponent(wallets, facility)!;
  wallet.money -= purchasable.cost;

  if (purchasable.kind === 'stock') {
    addToInventory(world, facility, purchasableId);
    return;
  }

  if (purchasable.kind === 'instant') {
    if (purchasableId === 'power-upgrade') {
      const powerCapacity = world.getComponent(powerCapacities, facility)!;
      powerCapacity.kw += POWER_UPGRADE_KW;
    } else if (purchasableId === 'cooling-upgrade') {
      const coolingCapacity = world.getComponent(coolingCapacities, facility)!;
      coolingCapacity.kw += COOLING_UPGRADE_KW;
    }
    return;
  }

  // 'room': advance to the next tier. purchasableId is `room-${tierId}` — the shop only ever
  // offers the immediate next tier as a catalog entry (game-data.ts's roomPurchasables), so
  // buying it always means "advance by one."
  const roomTier = world.getComponent(roomTiers, facility);
  if (!roomTier) return;
  const nextIndex = roomTier.index + 1;
  if (nextIndex < ROOM_TIERS.length) {
    roomTier.index = nextIndex;
  }
}

export function createShopSystem(world: World, controlled: EntityId): System {
  return {
    update() {
      const position = world.getComponent(positions, controlled);
      if (!position) return;

      const doorCenter = gridToWorld(SHOP_DOOR.gridX, SHOP_DOOR.gridY);
      const distance = Math.hypot(doorCenter.x - position.x, doorCenter.y - position.y);
      const inRange = distance <= SHOP_REACH_PX;
      const isOpen = world.getComponent(shopOpens, controlled) !== undefined;

      if (!inRange) {
        dismissedWhileInRange = false;
      }

      if (inRange && !isOpen && !dismissedWhileInRange) {
        world.addComponent(shopOpens, controlled, { open: true });
      } else if (!inRange && isOpen) {
        world.removeComponent(shopOpens, controlled);
      }
    },
  };
}
