# shop

`src/ecs/systems/shop.ts` — `createShopSystem(world, controlled)`, plus exported helpers
`buy`, `dismissShop`, `shopTab`, `shopCategories`, `shopCatalogForTab`

## Purpose

Proximity-based shop panel open/close (mirrors `rack-panel.ts`'s arrival pattern, but
simpler — no travel state, just in-range or not), and applying a purchase's effect.

## `createShopSystem` (the System)

- Reads: `Position` of `controlled`; the shop door's world position (`SHOP_DOOR` in
  `world-map.ts`)
- Writes: adds/removes `ShopOpen` on `controlled` based on `SHOP_REACH_PX` proximity
- Tracks a module-level `dismissedWhileInRange` flag (set by `dismissShop()`, called from
  `input.ts` on Escape) so dismissing while still in range doesn't reopen the panel the
  very next frame; cleared once the player actually leaves range.

## `buy(world, facility, purchasableId)`

Applies a purchase per its `PURCHASABLES` kind (see `game-data.ts` D6):
- `'stock'` (racks, machines) → `Inventory` count += 1, placed later via build mode
- `'instant'` (power/cooling upgrades) → capacity increased immediately
- `'room'` → `RoomTier.index` advances by one (the shop only ever offers the immediate
  next tier)

No-op if the wallet can't cover the cost (`canAfford`, floored comparison).

## Shared UI state

`shopTab` is a module-level (not per-entity) mutable object holding the selected
category — both `input.ts` (click handling) and `render.ts`/`hud.ts` (drawing) read/write
it directly, since there's only ever one player and one shop panel.

## Notes

- Click handling for the shop panel (close button, tab switching, buy buttons) lives in
  `input.ts`, not here — see [input](./input.md). This file owns only proximity
  lifecycle and the purchase side effect.
