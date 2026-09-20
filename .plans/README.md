# Plans index

Implementation plans for Datacenter Manager, in build order. Each plan is self-contained:
context, numbered design decisions (`D1`, `D2`, …), incremental steps, a files table,
trade-offs, and manual verification steps.

Per CLAUDE.md, verification is **manual** — no browser automation, no starting the project
from an agent.

## Built

| # | Plan | What it delivered |
| --- | --- | --- |
| — | [project-setup.md](project-setup.md) | Vite, TypeScript, canvas, module layout |
| — | [ecs-migration.md](ecs-migration.md) | `world.ts`, components, systems — the ECS foundation |
| — | [player-movement.md](player-movement.md) | Top-down movement, input module |
| — | [floor-rack-placement.md](floor-rack-placement.md) | Grid floor, rack placement |
| — | [pathfinding-collision.md](pathfinding-collision.md) | A*, walkability, rack collision |
| — | [build-panel.md](build-panel.md) | Buildable catalog, hotkeys, panel |
| — | [machines-and-racks.md](machines-and-racks.md) | Machine tiers, slots, install tasks |
| — | [workload-economy.md](workload-economy.md) | Contracts, money, reputation, brownouts |
| — | [workload-dispatch.md](workload-dispatch.md) | Traits, offers, drag-and-drop dispatch |
| — | [hud-and-escalation.md](hud-and-escalation.md) | HUD, alerts, difficulty curve |
| — | [facility-shop-inventory.md](facility-shop-inventory.md) | Camera, world map, shop, inventory, room tiers |
| — | [testing-strategy.md](testing-strategy.md) | Vitest, headless ECS/layout unit tests (no browser automation involved) |

## Playtest reports

| Report | What it covers |
| --- | --- |
| [playtest-findings.md](playtest-findings.md) | Bugs, friction and proposals from a played session |
| [compute-scale-fix.md](compute-scale-fix.md) | Fix for B3 (the demand-scaling deadlock) |
| [simulation-playtest.md](simulation-playtest.md) | Logic bugs and balance findings from a headless simulated session, numbered `S1`-`S13`. **Start at S1** — decommissioning a loaded server strands its contracts. |

## Code health

| Review | What it covers |
| --- | --- |
| [design-review.md](design-review.md) | Code smells, readability and structural debt in `src/`, numbered `F1`-`F17` and sequenced. Changes no behavior. |

## Proposed

Recommended build order. Each is independently shippable; the dependency notes say what
changes if you reorder.

| # | Plan | Size | Why this order |
| --- | --- | --- | --- |
| 7 | [time-controls.md](time-controls.md) | Small | **Build first.** Pause and fast-forward. Every plan below is tuned by watching the simulation, and today that only happens at 1x. Pays for itself during plan 8's tuning pass. |
| 8 | [power-billing.md](power-billing.md) | Small | Charges for power drawn per second. The cheapest change with the largest balance effect — it makes the deliberately lopsided server catalog finally matter, because efficiency becomes a stat. |
| 9 | [thermal-and-cooling.md](thermal-and-cooling.md) | **Large** | Per-rack heat, throttling, placeable cooling units. The plan that turns a menu game with a walking avatar into a spatial one. Splittable — see its trade-offs section. |
| 10 | [hardware-failure.md](hardware-failure.md) | Medium | Wear, failure, repair, decommission. Gives the player character a job and makes the walk meaningful. Build after 9 so heat drives wear. |
| 11 | [contract-variety.md](contract-variety.md) | Small-Medium | Penalties and recurring contracts. Fixes the "accept everything" dominant strategy and introduces committed capacity. Independent of 9-10; can be pulled forward. |
| 12 | [research-tree.md](research-tree.md) | Medium | Permanent, partly exclusive upgrades. **Build last** — most of its interesting nodes modify constants that plans 8-10 introduce. |
| 13 | [mobile-touch-support.md](mobile-touch-support.md) | Medium | Pointer-event touch input, pinch/ctrl+wheel zoom, touch-friendly hit targets, DPR-correct rendering. Independent of the others — can be pulled forward any time gameplay needs to be checked on a phone/tablet. |
| — | [ideas-backlog.md](ideas-backlog.md) | — | Unpromoted ideas, sized and sequenced, plus a record of what was considered and rejected. |

## If you only build one

**Plan 9 (thermal).** It is the largest, but it is the one that makes the grid, the camera,
the room tiers, and the walking avatar all pay off at once. Everything else sharpens an
existing decision; thermal adds a new axis.

**If you only build one small one:** plan 8 (power billing). It is roughly one line in
`resource.ts` plus a HUD readout plus a tuning pass, and it repairs a live balance hole.

## Conventions these plans follow

- **Design decisions are numbered and referenced** (`D1`, `D2`) so steps and code comments can
  cite them without restating the reasoning.
- **Steps are ordered so the game is playable after each one.**
- **Trade-offs are stated, including rejected alternatives and why** — the rejections are
  often more useful later than the choices.
- **Pure math lives in its own ECS-free module** (`traits.ts`, and the proposed `thermal.ts`,
  `wear.ts`, `modifiers.ts`) so it is testable alone.
- **Derived caches are recomputed from scratch every tick.** Plans 9 and 10 introduce the
  first deliberate exceptions — `Temperature` and `Condition` are *integrated state*, carry
  history, and are flagged loudly in both plans because a future reader will otherwise assume
  they are caches.
- **`Powered.online` has exactly one writer** (`resource.ts`). Plans 9 and 10 add veto
  components it reads, rather than adding writers.
