// Shop lifecycle: proximity open/close (mirrors rack-panel.ts's arrival pattern, but simpler —
// no travel state to track, just in-range or not), buy(), which applies D6's three purchasable
// kinds, and (F7) click hit-testing — handleShopClick, called from input.ts's click-priority
// chain once the shop is the active modal (see ../modal.ts). See
// .plans/facility-shop-inventory.md Step 5.
import { type World, type EntityId } from '../world';
import {
  positions,
  gridToWorld,
  shopOpens,
  wallets,
  powerCapacities,
  coolingCapacities,
  roomTiers,
} from '../components';
import {
  PURCHASABLES,
  ROOM_TIERS,
  POWER_UPGRADE_KW,
  COOLING_UPGRADE_KW,
  type PurchasableId,
} from '../game-data';
import { SHOP_DOOR } from '../world-map';
import { addToInventory } from '../inventory';
import { recordShopPurchase } from './tutorial';
import {
  getShopCloseButtonRect,
  getShopTabRect,
  getShopBuyButtonRect,
  pointerInRect,
} from '../../ui/layout';
import { type Renderer } from '../../rendering';
import { type Audio } from '../../audio';
import { type System } from './system';
import { registerModalCloser, closeOtherModals } from '../modal';

const SHOP_REACH_PX = 80; // ~2 grid cells — close enough to the shop door to browse

// Set when the player dismisses the panel with Escape while still in range (input.ts) — without
// this, proximity would reopen it the very next frame. Cleared once they leave range, so
// walking away and back re-opens it normally.
let dismissedWhileInRange = false;

export function dismissShop(): void {
  dismissedWhileInRange = true;
}

// Registered as the 'shop' modal closer — see ../modal.ts. Also used directly by input.ts's
// close-button handler and Escape, which need the same "don't let proximity reopen it next
// frame" behavior.
export function closeShop(world: World, controlled: EntityId): void {
  world.removeComponent(shopOpens, controlled);
  dismissShop();
}

registerModalCloser('shop', closeShop);

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
// applied now, 'room' → room tier advances now. Rejected (no-op, returns false) if the wallet
// can't cover it. Returns true iff a purchase was actually applied — input.ts uses this to
// tell a real buy from a rejected click (e.g. to advance the tutorial's shop step).
export function buy(world: World, facility: EntityId, purchasableId: PurchasableId): boolean {
  const purchasable = PURCHASABLES.find((p) => p.id === purchasableId);
  if (!purchasable) return false;
  if (!canAfford(world, facility, purchasable.cost)) return false;

  const wallet = world.getComponent(wallets, facility)!;
  wallet.money -= purchasable.cost;

  if (purchasable.kind === 'stock') {
    addToInventory(world, facility, purchasableId);
    return true;
  }

  if (purchasable.kind === 'instant') {
    if (purchasableId === 'power-upgrade') {
      const powerCapacity = world.getComponent(powerCapacities, facility)!;
      powerCapacity.kw += POWER_UPGRADE_KW;
    } else if (purchasableId === 'cooling-upgrade') {
      const coolingCapacity = world.getComponent(coolingCapacities, facility)!;
      coolingCapacity.kw += COOLING_UPGRADE_KW;
    }
    return true;
  }

  // 'room': advance to the next tier. purchasableId is `room-${tierId}` — the shop only ever
  // offers the immediate next tier as a catalog entry (game-data.ts's roomPurchasables), so
  // buying it always means "advance by one."
  const roomTier = world.getComponent(roomTiers, facility);
  if (!roomTier) return false;
  const nextIndex = roomTier.index + 1;
  if (nextIndex < ROOM_TIERS.length) {
    roomTier.index = nextIndex;
    return true;
  }
  return false;
}

// F7: panel hit-testing, moved here from input.ts — this module owns the shop's tabs/buy rows
// (it already draws against the same layout getters in render.ts), so the click targets live
// next to it. Called from input.ts's click-priority chain only once activeModal() (../modal.ts)
// is already 'shop'; ordering there is load-bearing the same way the rack panel's is (both
// absorb every click while open).
export function handleShopClick(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  facility: EntityId,
  pointer: { x: number; y: number },
  audio: Audio,
): void {
  const rowCount = shopCatalogForTab(shopTab.current).length;
  const closeRect = getShopCloseButtonRect(renderer.width, renderer.height, rowCount);
  if (pointerInRect(pointer, closeRect)) {
    closeShop(world, controlled);
    return;
  }

  const categories = shopCategories();
  for (let tabIndex = 0; tabIndex < categories.length; tabIndex++) {
    const tabRect = getShopTabRect(tabIndex, categories.length, renderer.width, renderer.height, rowCount);
    if (pointerInRect(pointer, tabRect)) {
      shopTab.current = categories[tabIndex];
      return;
    }
  }

  const rows = shopCatalogForTab(shopTab.current);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const buyRect = getShopBuyButtonRect(rowIndex, renderer.width, renderer.height, rowCount);
    if (pointerInRect(pointer, buyRect)) {
      audio.play('uiClick');
      if (buy(world, facility, rows[rowIndex].id)) {
        recordShopPurchase(world, facility);
      }
      return;
    }
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
        // Only one modal at a time (see ../modal.ts) — proximity to the shop always wins over
        // any other open panel.
        closeOtherModals(world, controlled, 'shop');
        world.addComponent(shopOpens, controlled, { open: true });
      } else if (!inRange && isOpen) {
        world.removeComponent(shopOpens, controlled);
      }
    },
  };
}
