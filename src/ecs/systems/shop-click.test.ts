// handleShopClick was extracted from input.ts into a plain function taking a Renderer
// (read-only, width/height) and a point, so it can be exercised headlessly.
import { describe, it, expect } from 'vitest';
import { handleShopClick, getShopTab, shopCategories } from './shop';
import { activeModals, wallets, inventories } from '../components';
import { PURCHASABLES, type PurchasableId } from '../game-data';
import { type EntityId } from '../world';
import { getShopCloseButtonRect, getShopTabRect, getShopBuyButtonRect } from '../../ui/layout';
import { createTestFacility, stubAudio, stubRenderer, stubEventBus } from '../test-helpers';

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 800;

function centerOf(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

describe('handleShopClick', () => {
  it('closes the shop when the close button is clicked', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    world.addComponent(activeModals, player, { kind: 'shop' });

    const rowCount = PURCHASABLES.filter((p) => p.category === getShopTab(world, player)).length;
    const closeRect = getShopCloseButtonRect(CANVAS_WIDTH, CANVAS_HEIGHT, rowCount);
    handleShopClick(
      world,
      stubRenderer(CANVAS_WIDTH, CANVAS_HEIGHT),
      player,
      facility,
      centerOf(closeRect),
      stubAudio(),
      stubEventBus(),
    );

    expect(world.getComponent(activeModals, player)).toBeUndefined();
  });

  it('switches tabs when a category tab is clicked, per player (F15)', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    world.addComponent(activeModals, player, { kind: 'shop' });

    const categories = shopCategories();
    expect(categories.length).toBeGreaterThan(1);
    const currentTab = getShopTab(world, player);
    const targetIndex = categories.findIndex((c) => c !== currentTab);
    const rowCount = PURCHASABLES.filter((p) => p.category === currentTab).length;
    const tabRect = getShopTabRect(targetIndex, categories.length, CANVAS_WIDTH, CANVAS_HEIGHT, rowCount);

    handleShopClick(
      world,
      stubRenderer(CANVAS_WIDTH, CANVAS_HEIGHT),
      player,
      facility,
      centerOf(tabRect),
      stubAudio(),
      stubEventBus(),
    );

    expect(getShopTab(world, player)).toBe(categories[targetIndex]);
  });

  it('buys a stock item and adds it to inventory when affordable', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    world.addComponent(activeModals, player, { kind: 'shop' });

    const rows = PURCHASABLES.filter((p) => p.category === getShopTab(world, player));
    const rowIndex = rows.findIndex((p) => p.kind === 'stock');
    const purchasable = rows[rowIndex];
    const wallet = world.getComponent(wallets, facility)!;
    wallet.money = purchasable.cost + 100;
    const before = world.getComponent(inventories, facility)!.counts[purchasable.id] ?? 0;

    const buyRect = getShopBuyButtonRect(rowIndex, CANVAS_WIDTH, CANVAS_HEIGHT, rows.length);
    const events = stubEventBus();
    let purchasedPayload: { facility: EntityId; purchasableId: PurchasableId } | undefined;
    events.on('shop:purchased', (payload) => {
      purchasedPayload = payload;
    });
    handleShopClick(
      world,
      stubRenderer(CANVAS_WIDTH, CANVAS_HEIGHT),
      player,
      facility,
      centerOf(buyRect),
      stubAudio(),
      events,
    );

    expect(world.getComponent(inventories, facility)!.counts[purchasable.id]).toBe(before + 1);
    expect(wallet.money).toBe(100);
    expect(purchasedPayload).toEqual({ facility, purchasableId: purchasable.id });
  });

  it('does not buy when the wallet cannot afford it', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    world.addComponent(activeModals, player, { kind: 'shop' });

    const rows = PURCHASABLES.filter((p) => p.category === getShopTab(world, player));
    const rowIndex = rows.findIndex((p) => p.kind === 'stock');
    const purchasable = rows[rowIndex];
    const wallet = world.getComponent(wallets, facility)!;
    wallet.money = purchasable.cost - 1;
    const before = world.getComponent(inventories, facility)!.counts[purchasable.id] ?? 0;

    const buyRect = getShopBuyButtonRect(rowIndex, CANVAS_WIDTH, CANVAS_HEIGHT, rows.length);
    handleShopClick(
      world,
      stubRenderer(CANVAS_WIDTH, CANVAS_HEIGHT),
      player,
      facility,
      centerOf(buyRect),
      stubAudio(),
      stubEventBus(),
    );

    expect(world.getComponent(inventories, facility)!.counts[purchasable.id] ?? 0).toBe(before);
    expect(wallet.money).toBe(purchasable.cost - 1);
  });
});
