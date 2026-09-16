# render

`src/ecs/systems/render.ts` — `createRenderSystem(world, renderer, controlled, facility, camera, input)`

## Purpose

All Canvas drawing of the game floor: the building/room, shop building and corridor,
racks (with per-slot state and load labels), the player sprite, build panel + tooltip,
install progress indicator, the rack panel (server rows, tray, drag ghost, scrollbar),
and the shop panel. Presentation only — reads component state, writes nothing back
except transient UI concerns owned elsewhere (drag/scroll are mutated by `rack-panel.ts`,
not here).

## Structure

One `draw*` function per visual piece, called in back-to-front order from the returned
`System.update`. Notable ones:

- `drawOutdoors` — flat ground fill + a sparse deterministic dot scatter over the full
  world rect, drawn FIRST so the building/shop/corridor paint over it. Without this the
  area outside the room/corridor/shop was an uncleared, transparent canvas reading as a
  black void (F8).
- `drawBuilding` — floor, floor-grid tiles, walls, and a ghost outline of the next room
  tier (legible upgrade preview without a menu)
- `drawShopAndCorridor` — the shop building and the outdoor corridor connecting it to the
  room (the second walkable location the camera needs to reach)
- `drawRack` / `drawRackLoadLabel` — rack cabinet + per-slot state
  (`online-idle` / `'partial'` / `'full'`, based on whether any/all `ServerCapacity.free`
  traits are exhausted), plus a thin per-slot `TIER_ACCENT_COLOR` stripe keyed by
  `MachineTierId` (additive, drawn on top of the existing slat fill/LED — F8) + under-rack
  power/heat readout colored against facility headroom. The label only draws for the rack
  under the pointer (`input.getPointerPosition()` → `camera.screenToWorld` →
  `worldToGrid`) or, regardless of hover, every rack while the facility is still on the
  closet room tier (`RoomTier.index === 0`) — see F8; `drawThermalBadge` is untouched
  since it already self-gates on an abnormal state.
- `drawFloatingTexts` — world-space, rising/fading `FloatingText` entities (e.g. a
  completed contract's `+$N` — F7), drawn just before `camera.resetTransform` so it
  tracks the floor like any other world object.
- `drawManager` — the player sprite
- `drawShopHint` — arrow pointing from player to shop door when inventory is empty
- `drawBuildPanel` / `drawBuildPanelTooltip` — the build hotbar and its hover tooltip
- `drawInstallIndicator` — progress overlay while an `InstallTask` is active
- `drawRackPanel` — the big one: header, close button, rack-wide draw total, scrollable
  server rows + tray (clipped and translated by `RackScroll.offsetPx`), scrollbar, and the
  actively-dragged card (drawn last, screen-space, on top of everything)
- `drawShopPanel` — category tabs + buy rows

## Notes

- `drawRackPanel` takes no mode-dependent branch for its own drawing — viewing-mode
  panels render identically to arrived dispatching-mode ones (only the header text
  differs) per the rack-panel design (D4). Drag/rejection chrome is skipped in viewing
  mode since neither is meaningful there.
- Content-space vs. screen-space matters here: server rows/tray/chips are laid out in
  unscrolled content space (`ui/layout.ts`'s `getServerRowRect` etc.), clipped and
  translated by scroll offset for drawing, but the dragged card and any tooltip follow
  the raw cursor in screen space — see [rack-panel](./rack-panel.md)'s `toContentSpace`
  for the inverse operation used by hit-testing.
- Runs in `renderSystems`, after `camera` and before `hud`, so it draws against this
  frame's eased camera position. See the [update order](./README.md#update-order).
