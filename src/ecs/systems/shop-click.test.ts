// F7/F16: handleShopClick was extracted from input.ts into a plain function taking a Renderer
// (read-only, width/height) and a point, so it can be exercised headlessly.
import { describe, it, expect, beforeEach } from 'vitest';
import { handleShopClick, shopTab, shopCategories } from './shop';
import { shopOpens, wallets, inventories } from '../components';
import { PURCHASABLES } from '../game-data';
import { getShopCloseButtonRect, getShopTabRect, getShopBuyButtonRect } from '../../ui/layout';
import { createTestFacility, stubAudio, stubRenderer } from '../test-helpers';

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 800;

function centerOf(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

// shopTab is module-level mutable state (F15) shared across every test in this process — reset
// it explicitly so one test's tab selection can't leak into the next.
beforeEach(() => {
  shopTab.current = PURCHASABLES[0].category;
});

describe('handleShopClick', () => {
  it('closes the shop when the close button is clicked', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    world.addComponent(shopOpens, player, { open: true });

    const rowCount = PURCHASABLES.filter((p) => p.category === shopTab.current).length;
    const closeRect = getShopCloseButtonRect(CANVAS_WIDTH, CANVAS_HEIGHT, rowCount);
    handleShopClick(
      world,
      stubRenderer(CANVAS_WIDTH, CANVAS_HEIGHT),
      player,
      facility,
      centerOf(closeRect),
      stubAudio(),
    );

    expect(world.getComponent(shopOpens, player)).toBeUndefined();
  });

  it('switches tabs when a category tab is clicked', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    world.addComponent(shopOpens, player, { open: true });

    const categories = shopCategories();
    expect(categories.length).toBeGreaterThan(1);
    const targetIndex = categories.findIndex((c) => c !== shopTab.current);
    const rowCount = PURCHASABLES.filter((p) => p.category === shopTab.current).length;
    const tabRect = getShopTabRect(targetIndex, categories.length, CANVAS_WIDTH, CANVAS_HEIGHT, rowCount);

    handleShopClick(
      world,
      stubRenderer(CANVAS_WIDTH, CANVAS_HEIGHT),
      player,
      facility,
      centerOf(tabRect),
      stubAudio(),
    );

    expect(shopTab.current).toBe(categories[targetIndex]);
  });

  it('buys a stock item and adds it to inventory when affordable', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    world.addComponent(shopOpens, player, { open: true });

    const rows = PURCHASABLES.filter((p) => p.category === shopTab.current);
    const rowIndex = rows.findIndex((p) => p.kind === 'stock');
    const purchasable = rows[rowIndex];
    const wallet = world.getComponent(wallets, facility)!;
    wallet.money = purchasable.cost + 100;
    const before = world.getComponent(inventories, facility)!.counts[purchasable.id] ?? 0;

    const buyRect = getShopBuyButtonRect(rowIndex, CANVAS_WIDTH, CANVAS_HEIGHT, rows.length);
    handleShopClick(
      world,
      stubRenderer(CANVAS_WIDTH, CANVAS_HEIGHT),
      player,
      facility,
      centerOf(buyRect),
      stubAudio(),
    );

    expect(world.getComponent(inventories, facility)!.counts[purchasable.id]).toBe(before + 1);
    expect(wallet.money).toBe(100);
  });

  it('does not buy when the wallet cannot afford it', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    world.addComponent(shopOpens, player, { open: true });

    const rows = PURCHASABLES.filter((p) => p.category === shopTab.current);
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
    );

    expect(world.getComponent(inventories, facility)!.counts[purchasable.id] ?? 0).toBe(before);
    expect(wallet.money).toBe(purchasable.cost - 1);
  });
});
