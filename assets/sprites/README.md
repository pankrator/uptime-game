# Sprite assets

Generated pixel-art assets for the datacenter floor. **Nothing in `src/` loads these yet** —
the game still draws every entity procedurally in `src/ecs/systems/render.ts`. They exist so the
art can be reviewed and iterated on separately from the renderer.

Regenerate with:

```
npm run sprites
```

Everything under this folder is written by `tools/generate-sprites.ts` and the folder is wiped on
each run — edit the generator, not the PNGs.

## What's here

| Group    | Size  | Files                                                                                       |
| -------- | ----- | ------------------------------------------------------------------------------------------- |
| Racks    | 32×32 | `rack-empty`, `rack-partial`, `rack-full`, `rack-offline`, `rack-failed`                    |
| Cooling  | 32×32 | `crac-0`, `crac-1` (two fan frames — alternate for a spin loop)                             |
| Floor    | 32×32 | `floor-tile`, `floor-tile-vent` (both tile seamlessly)                                      |
| Machines | 64×16 | `server-budget`, `server-basic`, `server-dense`, `server-storage`, `server-memory`          |
| Manager  | 24×32 | `manager-{down,left,right,up}-{0,1,2}` (frame 0 is the standing pose)                       |
| Icons    | 16×16 | `icon-{power,heat,cooling,temperature,money,wrench,warning,workload,network,clock,ok,fail}` |

Each sprite is written at two scales: `1x/<name>.png` and `2x/<name>.png`. The 2x copies are
nearest-neighbour upscales, there so `CAMERA_ZOOM_MAX` (2) can be drawn without the browser
resampling a 1x image.

Grid-packed sheets are in `sheets/` (`racks`, `crac`, `servers`, `manager`, `icons`), each with an
`@2x` twin. Frames sit in uniform cells, so a frame's position is `(col * frameWidth, row *
frameHeight)` — no manifest lookup needed at draw time.

`sprites.json` lists every sprite and sheet with its dimensions, file paths and frame rectangles.

`preview.png` is a contact sheet of the whole set at 2x, one band per group, in the table's order.

## Sizing

Sizes are derived from the constants the renderer already uses, so a sprite can replace the
matching procedural drawing without re-tuning layout:

- `GRID_CELL_SIZE` is 40 and `RACK_PADDING` is 4, so floor structures (racks, CRACs, tiles) are
  32×32 and drop into a cell at `+4, +4`.
- A rack holds `RACK_SLOT_CAPACITY` (6) slats, which is what the rack sprites show.
- `PLAYER_RADIUS` is 12, so the manager is 24 wide; 32 tall leaves room for the head above the
  collision circle. Feet sit on the last row, so the sprite anchors at `(x - 12, y - 20)`.
- Machine chassis are 64×16 — sized for the rack panel's server rows, not the floor cell.

## Palette

Colours are the ones already in `render.ts`: `#3a3f47` cabinet, `#20242a` edges, `#2e343b`
populated slat, `#22262b` empty slat, `#3ddc84`/`#4dabf7`/`#f7b731`/`#e5484d` status LEDs,
`#2b4a5c` CRAC body, `#1c1f22`/`#25292d` floor. The one addition is `#a78bfa` on the memory tier,
so it can't be mistaken for the storage tier at a glance.
