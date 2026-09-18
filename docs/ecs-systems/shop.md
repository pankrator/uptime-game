# shop

`src/ecs/systems/shop.ts` — `createShopSystem(world, controlled)`, plus exported helpers
`buy`, `handleShopClick`, `closeShop`, `dismissShop`, `getShopTab`, `setShopTab`,
`shopCategories`, `shopCatalogForTab`

## Purpose

Proximity-based shop panel open/close (mirrors `rack-panel.ts`'s arrival pattern, but
simpler — no travel state, just in-range or not), applying a purchase's effect, and (F7)
click hit-testing.

## `createShopSystem` (the System)

- Reads: `Position` of `controlled`; the shop door's world position (`SHOP_DOOR` in
  `world-map.ts`)
- Writes: adds/removes `ActiveModal`'s `'shop'` variant on `controlled` based on
  `SHOP_REACH_PX` proximity — directly, not via `closeShop`, since leaving range must not also
  call `dismissShop()` (that would block proximity from reopening it on the way back in)
- Tracks a module-level `dismissedWhileInRange` flag (set by `dismissShop()`, called from
  `input.ts` on Escape) so dismissing while still in range doesn't reopen the panel the
  very next frame; cleared once the player actually leaves range.
- Calls `ecs/modal.ts`'s `openModal` right before opening — only one modal (rack, shop, offers,
  jobs) can ever be recorded as open at once (`ActiveModal` is a single tagged-union component),
  and proximity to the shop always wins over an already-open offers/jobs panel (which has no
  proximity trigger of its own to race against). The reverse also holds: pressing `O`/`J` while
  the shop is open runs this module's own `closeShop` (registered as the `'shop'` closer, so
  `dismissShop()` still fires and proximity doesn't just reopen it the next frame) before
  switching to the requested panel.

## `buy(world, facility, purchasableId)`

Applies a purchase per its `PURCHASABLES` kind (see `game-data.ts` D6):
- `'stock'` (racks, machines) → `Inventory` count += 1, placed later via build mode
- `'instant'` (power/cooling upgrades) → capacity increased immediately
- `'room'` → `RoomTier.index` advances by one (the shop only ever offers the immediate
  next tier)

No-op if the wallet can't cover the cost (`canAfford`, floored comparison). Returns `true`
iff a purchase was actually applied — `input.ts` uses this to tell a real buy from a
rejected click (e.g. to advance the [tutorial](./tutorial.md)'s shop step).

## Shared UI state

`ShopTab` (F15) is a per-player component holding the selected category, lazily seeded by
`getShopTab`/`setShopTab` — both this module's `handleShopClick` and `render.ts`'s
`drawShopPanel` read/write it through the component.

## Notes

- Click handling for the shop panel (close button, tab switching, buy buttons) is
  `handleShopClick` (F7), called from `input.ts`'s click-priority chain once
  `ecs/modal.ts`'s `activeModal` reports `'shop'` — see [input](./input.md). This file owns
  proximity lifecycle, the purchase side effect, and this click hit-testing.
