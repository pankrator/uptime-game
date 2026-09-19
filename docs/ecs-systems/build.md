# build

`src/ecs/systems/build.ts` — `selectBuildable`, `hitTestBuildPanel`, `handleBuildPanelClick`,
`handleBuildModePlacement`. No `System` of its own — build mode has no per-frame behavior beyond
reacting to a click/key, same as offers/jobs' click handlers.

## Purpose

Owns build mode end to end: toggling it (panel click or number-key hotkey, both call
`selectBuildable`) and placing a buildable into the world once it's active. Extracted from
`input.ts`'s click router (`.plans/input-router-refactor.md` D3) — `input.ts` decides WHEN a
click reaches these, never WHAT they do, same split as `rack-panel.ts`'s `handleRackPanelClick` /
`shop.ts`'s `handleShopClick`.

## `handleBuildPanelClick(world, controlled, pointer, canvasHeight)`

Hit-tests the build panel entries (`getBuildPanelEntryRect`) and calls `selectBuildable` on a
hit. Returns `true` if handled, so `input.ts`'s router knows whether to fall through to build-mode
placement (a build panel click and a placement click are mutually exclusive within one frame).

## `handleBuildModePlacement(world, controlled, facility, camera, pointer, audio)`

Called only while build mode is active (the router gates this). Resolves the clicked screen point
to a grid cell and branches on the active buildable's `placement`:
- `'empty-cell'` (racks, CRACs) — must be inside the room, the cell must be unoccupied, and
  inventory must cover the cost (`takeFromInventory`); spawns via `entities.ts`'s `spawnRack`/
  `spawnCoolingUnit` and stays in build mode (lets the player lay out a row of the same buildable
  quickly).
- `'rack'` (machine tiers) — finds the rack under the cursor (`rack-panel.ts`'s `findRackAt`) and
  starts an install (`maintenance.ts`'s `startInstall`) if one's there; always exits build mode
  afterward (installs are one-shot, unlike empty-cell placement).

## Notes

- `selectBuildable` toggles `BuildMode` off if the same buildable is already selected (a second
  press/click on the same entry cancels build mode rather than re-selecting it).
- See [input](./input.md) for how a click/key reaches these, and `.plans/build-panel.md` for the
  original build panel/hotkey design.
