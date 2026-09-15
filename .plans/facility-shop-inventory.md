# Facility, shop, and inventory: a world bigger than the screen

> **Plan 6.** Depends on `.plans/workload-dispatch.md` (rack panel, drag-and-drop, offers) and
> `.plans/pathfinding-collision.md` (grid pathfinding). Supersedes the "floor == canvas"
> assumption in `.plans/floor-rack-placement.md` and the direct-purchase half of
> `.plans/build-panel.md`.

## Context

Today the datacenter floor **is** the canvas. `getFloorGridBounds()`
([pathfinding.ts:14-26](src/ecs/pathfinding.ts#L14-L26)) derives the walkable rect from
`canvas.width/height` minus `BUILDING_MARGIN`, `drawBuilding()`
([render.ts:47-97](src/ecs/systems/render.ts#L47-L97)) draws walls at the canvas edge, and
every pointer coordinate from `input.getPointerPosition()` is fed straight into
`worldToGrid()` with no transform. There is exactly one space: canvas pixels == world pixels
== HUD pixels. Resizing the browser window literally resizes the datacenter.

That blocks three things the game now needs:

1. **The facility should start small and be upgraded.** Right now its size is whatever the
   window is — there is no "small room", and nothing to buy to make it bigger.
2. **There should be a shop elsewhere on the map.** A second location requires a world larger
   than the viewport, which requires a camera.
3. **Buying should be separated from placing.** Today `selectBuildable()`
   ([input.ts:212-224](src/ecs/systems/input.ts#L212-L224)) debits the wallet at *placement*
   time — `spawnRack` and `tryInstallIntoRack` each do their own `canAfford`/`wallet.money -=`.
   Money is spent wherever the player happens to click on the floor. With a shop, money is
   spent at the shop, and the floor only ever consumes things you already own.

The intended outcome: a fixed-size world map containing a small starting room (upgradable
through a tier ladder) and a separate shop building. The camera follows the player and can be
panned. The player walks to the shop, buys stock into an inventory, walks back, and places
from inventory onto the floor.

**The camera is the load-bearing change.** The shop, the room tiers, and the inventory are all
straightforward once world-space and screen-space are distinct; none of them are safe to build
first. Steps are ordered so the game is playable after each one.

---

## Design decisions

These constrain everything below.

### D1. World space and screen space become distinct, with one conversion point

A new `src/camera/index.ts` module owns the transform. Everything that is *in the world*
(entity `Position`, `GridPosition`, floor, racks, shop, walls) is world-space. Everything that
is *UI* (HUD bar, build panel, offer cards, rack panel, shop panel) is screen-space and
unchanged.

```ts
export interface Camera {
  x: number; y: number;              // world coords of the viewport's top-left
  worldToScreen(p: Point): Point;
  screenToWorld(p: Point): Point;
  applyTransform(ctx): void;         // ctx.save(); ctx.translate(-x, -y)
  resetTransform(ctx): void;         // ctx.restore()
  update(dt, target: Point, canvas): void;  // follow + pan + clamp
}
```

Rendering uses `applyTransform`/`resetTransform` rather than transforming each draw call —
world draws stay written in world coordinates and need no edits beyond being bracketed.

Input is the opposite: there is **no** blanket conversion. Each click-chain branch decides for
itself, because the chain interleaves UI and world hit-tests. The rule, stated once here and
repeated as a comment in `input.ts`:

> HUD/panel hit-tests use the raw screen pointer. World hit-tests (`worldToGrid`,
> `moveControlledTo`, shop-door proximity) use `camera.screenToWorld(pointer)`.

This is the single riskiest part of the change — a missed conversion is a subtly mis-aimed
click, not a crash. Step 1 converts every call site in one pass and lists them explicitly.

### D2. The world is a fixed-size rect, not infinite

`WORLD_WIDTH`/`WORLD_HEIGHT` in `game-data.ts`, sized to comfortably hold the largest room
tier plus the shop plus outdoor space between them. A fixed world means the camera clamps to
known bounds and pathfinding has a known extent; an infinite world buys nothing here.

### D3. Walkability becomes region-based, not canvas-based

`getFloorGridBounds(canvas)` is replaced by a `Walkable` concept that is the **union** of
named rectangular regions — the current room tier's interior, the shop's interior, and the
outdoor path connecting them — minus obstacle cells. This is the minimum change that lets the
player walk from the room to the shop while still being blocked by walls.

`isWalkable()` keeps its signature shape but takes a `WorldRegions` value instead of a
`GridBounds`. A* ([pathfinding.ts:59-128](src/ecs/pathfinding.ts#L59-L128)) is untouched —
it only ever calls `isWalkable`.

Doorways matter: each building's wall rect has a one-or-two-cell gap marked walkable, so the
player enters through a door rather than clipping through a wall. Without this, A* would fail
to find any path between outside and inside.

### D4. Room tiers are a fixed ladder, anchored at a fixed top-left

Buying a tier grows the room **right and down** from a fixed origin, so existing racks never
end up outside the room or inside a wall. Growing outward in all directions would require
re-validating every placed rack; anchoring makes upgrades strictly additive.

Racks are still blocked from being placed outside the current tier's interior — that check
replaces today's implicit "inside the canvas" bound.

### D5. Inventory is a facility component, keyed by a purchasable id

```ts
export interface Inventory { counts: Partial<Record<PurchasableId, number>> }
```

One component on the facility singleton, not one entity per owned item. Owned-but-unplaced
items have no position, no behavior, and no per-item state — a count is the whole truth, and
spawning entities for them would mean filtering them out of every existing `query(machines)`
call. Placing decrements; the entity is spawned only at placement, exactly as today.

### D6. Purchasables unify what the shop sells

`BUILDABLES` in [components.ts:67-79](src/ecs/components.ts#L67-L79) currently mixes three
placement kinds, including `'purchase'` for power/cooling. That split moves to the shop:

| Kind | Examples | Bought at shop → | Then |
| --- | --- | --- | --- |
| `stock` | rack, each machine tier | inventory count +1 | placed from build panel, consumes 1 |
| `instant` | +5kW power, +5kW cooling | applied immediately | — |
| `room` | next room tier | applied immediately | — |

`BUILDABLES` keeps deriving from `MACHINE_TIERS` the way it does today (so a new tier still
needs no code change), but its entries lose `cost` — the build panel no longer knows prices,
only counts. Prices live in the shop catalog.

### D7. Placement becomes free; the shop is the only place money leaves the wallet

`tryInstallIntoRack` ([input.ts:164-196](src/ecs/systems/input.ts#L164-L196)) and the
rack-placement branch both drop their `canAfford`/`wallet.money -=` lines and instead check
and decrement inventory. `cancelInstallTask`
([input.ts:150-162](src/ecs/systems/input.ts#L150-L162)) refunds **to inventory**, not to the
wallet — the item was bought and is still owned; only the install was abandoned.

---

## Steps

Each step leaves the game runnable.

### Step 1 — Camera and world space

**New** `src/camera/index.ts`: the `Camera` above. Follow behavior: ease toward the player,
`x/y` clamped so the viewport never shows outside the world rect (with a smaller world than
viewport on an axis, center on that axis). Edge pan: pointer within ~24px of a screen edge
pans at a fixed rate; arrow keys / WASD pan directly; a key (`c`) re-centers on the player.
Panning sets a `detached` flag that following is suspended under until re-centered — otherwise
follow and pan fight each other every frame.

**`game-data.ts`**: `WORLD_WIDTH`, `WORLD_HEIGHT`, camera constants.

**`main.ts`**: construct the camera, thread it into the input, render, and rack-panel systems
(constructor arg, alongside `renderer`). Add a camera-update step — it runs in `renderSystems`,
not `updateSystems`, since it is presentation only and must not affect simulation when the tab
is hidden. Note the ordering dependency: the camera updates *before* the render systems read
it, so it goes first in that array.

**`render.ts`**: wrap the world-drawing portion of `update()`
([render.ts:565-640](src/ecs/systems/render.ts#L565-L640) — building, racks, install
indicator, player) in `applyTransform`/`resetTransform`. `drawBuildPanel`, `drawRackPanel`,
`drawPendingBorder` stay outside the transform. `drawBuilding` stops reading
`canvas.width/height` and draws the room rect instead (step 2 makes that rect dynamic; for now
a constant).

**`input.ts` / `rack-panel.ts`** — convert the world-space call sites. Exhaustively, these are:

- `input.ts` build-mode branch: `worldToGrid(pointer)` → `worldToGrid(screenToWorld(pointer))`
- `input.ts` rack-click branch (#4): same
- `input.ts` plain-move branch (#5): `moveControlledTo(..., pointer)` → world point
- `input.ts` `moveControlledTo`: takes a world point already; only its `getFloorGridBounds`
  call changes (step 3)
- `rack-panel.ts` right-click handler ([rack-panel.ts:320](src/ecs/systems/rack-panel.ts#L320)):
  `worldToGrid(pointer)` → world point

Untouched (correctly screen-space): `hitTestOfferButtons`, `hitTestPanel`, `pointerInHud`,
the rack-panel close button, and all of `tryStartDrag`/`updateDrag`/`resolveDrop` — panel
drag-and-drop is entirely UI.

**Gotcha:** `DragState.pointer` is drawn by render.ts. It stays screen-space, so the dragged
card must be drawn *outside* the camera transform.

*Playable after this step: identical game, camera follows the player, world no longer tied to
window size.*

### Step 2 — Room tiers

**`game-data.ts`**: `ROOM_TIERS` — an ordered array of `{ id, label, gridWidth, gridHeight,
cost }`, anchored at a shared `ROOM_ORIGIN` grid cell. Start at a genuinely small room (~6x5).

**`components.ts`**: `interface RoomTier { index: number }` + store, on the facility.

**`entities.ts`**: `spawnFacility` adds `RoomTier { index: 0 }`.

**New** `src/ecs/room.ts`: `getRoomRect(world, facility): GridRect` — the interior cell rect
for the current tier. One place that answers "where is the room", used by pathfinding,
rendering, and rack placement so the three can't disagree.

**`render.ts`**: `drawBuilding` takes the room rect. Draw the *next* tier's outline as a faint
dashed ghost when one exists — it makes the upgrade legible without a menu.

*Playable: small room, everything else as before.*

### Step 3 — World regions and walkability

**New** `src/ecs/world-map.ts`: `SHOP_RECT`, `CORRIDOR_RECT` (outdoor connector), door cells,
and `getWalkableRegions(world, facility): WorldRegions` composing them with the room rect from
step 2.

**`pathfinding.ts`**: replace `getFloorGridBounds(canvas)` with regions; `isWalkable` tests
"in some region AND not occupied". `findPath`, `findNearestWalkableNeighbor`, and
`simplifyPathToPixels` need no logic change.

**Performance note:** `isWalkable` currently does a linear `world.query(gridPositions)` scan
*per cell visited*, and A* visits many cells. Today's floor is small enough that this is fine;
a world several times larger with a long room→shop walk makes it O(cells × entities) on every
click. Build an occupied-cell `Set<string>` once per `findPath` call and pass it down. This is
a contained change (occupancy is only read, never mutated, during a path search) and avoids a
visible hitch later.

**`render.ts`**: draw the shop building and the corridor.

*Playable: player can walk from the room to the shop; shop is an empty building.*

### Step 4 — Inventory and purchasables

**`game-data.ts`**: `PurchasableId` and a `PURCHASABLES` catalog carrying
`{ id, label, kind: 'stock'|'instant'|'room', cost, category }`. Machine entries derive from
`MACHINE_TIERS`, mirroring how `BUILDABLES` does it today.

**`components.ts`**: `Inventory` (D5) on the facility; `BUILDABLES` loses `cost` and its
`'purchase'` entries.

**New** `src/ecs/inventory.ts`: `countOf`, `addToInventory`, `takeFromInventory`,
`hasInInventory`. Pure functions over the component — the systems that buy and place both go
through these rather than touching `counts` directly.

**`input.ts`**: apply D7 — placement checks and decrements inventory instead of the wallet;
`cancelInstallTask` refunds to inventory.

**`render.ts`**: build-panel entries show an owned count and grey out at zero.

*Playable: items must be owned to be placed — but nothing can be bought yet, so this step
temporarily seeds a starting inventory (which also becomes the real starting state).*

### Step 5 — Shop panel

**`components.ts`**: `ShopOpen` marker on the player, mirroring `OpenRackPanel`.

**`ui/layout.ts`**: shop panel rects — panel, category tabs, one row per catalog entry, a buy
button per row, close button. Follows the existing centered-modal geometry of
`getRackPanelRect` ([layout.ts:113-160](src/ui/layout.ts#L113-L160)).

**New** `src/ecs/systems/shop.ts`: proximity check (player within N cells of the shop door →
`ShopOpen`, walking away closes it), plus `buy(world, facility, purchasableId)` applying D6's
three kinds. Mirrors `rack-panel.ts`'s structure.

**`input.ts`**: a shop branch in the click chain, placed **immediately after the rack-panel
branch** — both are full-screen modals that absorb clicks, and the existing branch comments
explain why ordering there is load-bearing.

**`main.ts`**: register the shop system after `movement` (arrival-based, same as
`rack-panel`).

**`render.ts`**: draw the shop panel, screen-space, outside the camera transform.

*Playable: the full loop — walk to shop, buy, walk back, place.*

### Step 6 — Polish

Money/inventory summary in the HUD bar; a hint marker pointing toward the shop when inventory
is empty; `Escape` closes the shop panel.

---

## Files

| File | Change |
| --- | --- |
| `src/camera/index.ts` | **new** — transform, follow, pan, clamp |
| `src/ecs/room.ts` | **new** — current room rect from tier |
| `src/ecs/world-map.ts` | **new** — shop/corridor rects, walkable regions |
| `src/ecs/inventory.ts` | **new** — inventory helpers |
| `src/ecs/systems/shop.ts` | **new** — proximity, open/close, buy |
| `src/ecs/game-data.ts` | world size, `ROOM_TIERS`, `PURCHASABLES`, camera constants |
| `src/ecs/components.ts` | `RoomTier`, `Inventory`, `ShopOpen`; `BUILDABLES` loses cost |
| `src/ecs/pathfinding.ts` | regions replace canvas bounds; occupancy set |
| `src/ecs/systems/input.ts` | screen→world at world hit-tests; inventory not wallet; shop branch |
| `src/ecs/systems/render.ts` | camera transform; room tiers; shop; panel; counts |
| `src/ecs/systems/rack-panel.ts` | screen→world on the right-click handler |
| `src/ui/layout.ts` | shop panel rects |
| `src/entities/index.ts` | facility gets `RoomTier` + starting `Inventory` |
| `src/main.ts` | construct camera; thread it; register shop system |

## Trade-offs worth flagging

- **Two modals, one click chain.** The rack panel and shop panel are both full-screen
  absorbing modals. Rather than a general modal stack, they stay two explicit ordered branches
  — with two it is clearer; a third would justify the abstraction.
- **Walking to the shop is dead time.** That is the cost of the shop being a place. Step 6's
  hint marker mitigates it; if it still drags in play, the lever is moving the shop closer or
  widening the corridor, not adding fast travel.
- **`pointerInHud` gets a shop-panel case.** It already takes an `offerCount` parameter
  ([layout.ts:313](src/ui/layout.ts#L313)); this adds a second flag. Watch it — a third means
  it should take a UI-state object instead.

## Verification

Per CLAUDE.md, no browser automation, no starting the project — manual validation. Per step:

1. `npx tsc --noEmit` clean after each step.
2. **Camera:** player walks; camera follows and clamps at world edges; edge-pan and arrow keys
   detach, `c` re-centers. Clicking the floor walks to *where you clicked* while panned (the
   sharpest test that screen→world is right). Offer buttons, build panel, and rack-panel
   drag-and-drop still hit correctly while panned — that is the other half of D1.
3. **Room:** starts small; ghost outline shows the next tier; racks can't be placed outside.
4. **Walkability:** player paths room → door → corridor → shop door → shop; cannot cross walls;
   no hitch on long paths.
5. **Inventory:** placement consumes stock; at zero the entry greys out; cancelling an install
   returns the item to inventory (not money to the wallet).
6. **Shop:** panel opens on approach, closes on walking away; each kind applies correctly —
   stock raises a count, power/cooling raise capacity, a room tier grows the room; a purchase
   the wallet can't cover is rejected.
7. **Full loop:** start → walk to shop → buy rack + server → walk back → place both → dispatch
   a workload → earn → return and buy a room upgrade.
