# tutorial

`src/ecs/systems/tutorial.ts` — `createTutorialSystem(world, controlled, facility)`, plus
exported `TUTORIAL_STEPS`, `startTutorial`, `advanceTutorial`, `skipTutorial`,
`isTutorialActionStep`, `getTutorialStepDef`

## Purpose

Drives the first-time guided tutorial: a fixed sequence of steps played out in the real game
world (not a separate sandbox), each with a banner explaining what to do next. Finishing or
skipping only dismisses the banner — every action taken while it was up (the rack placed, the
machine installed, the workload dispatched) is real game state and carries straight into
normal play.

## Steps

`welcome -> move -> build-rack -> install-machine -> open-rack-panel -> accept-offer ->
place-workload -> done`

`'welcome'` and `'done'` (`isTutorialActionStep`) have no world-state completion check — they
only advance via the banner's own primary button (handled in `input.ts`). Every other step
auto-advances the instant its condition is met, checked by reading components other systems
already own — no new mutation paths, no gating of unrelated systems:

- `move` — distance travelled from `TutorialProgress.moveOrigin` (captured once at
  `startTutorial`) exceeds `MOVE_COMPLETE_DISTANCE_PX`
- `build-rack` — `world.query(rackSlots).length >= 1`
- `install-machine` — `world.query(machines).length >= 1`
- `open-rack-panel` — `OpenRackPanel` present and (`mode === 'viewing'` or `arrived`)
- `accept-offer` — `world.query(workloads).length >= 1`
- `place-workload` — `world.query(placedOns).length >= 1`

## Reads / writes

- Reads: `Position` (for the `move` check), plus the component stores listed above
- Writes: `TutorialProgress` on the facility entity (`stepId`, `skipped`) — a singleton, same
  pattern as `RoomTier`/`Inventory`/`Wallet`

## Notes

- `startTutorial(world, facility, playerPosition)` must run once, after both the facility and
  player entities exist (called from `main.ts` right after `spawnPlayer`) — it captures
  `moveOrigin` from the player's actual spawn point.
- Drawing lives in `hud.ts` (`drawTutorialBanner`, run last so it stays on top of the rack/shop
  panels' full-screen dim), and rects live in `ui/layout.ts` (`getTutorialBannerRect` et al.) —
  same split as every other panel in this codebase (state-owning system + `hud.ts`/`render.ts`
  draws it).
- The banner's skip link and welcome/done primary button are hit-tested in `input.ts`, checked
  early (right after the mute button) so they're reachable regardless of build mode, an active
  install task, or an open rack/shop panel — see [input](./input.md).
- Runs last in `updateSystems` (see the [update order](./README.md#update-order)): it only
  reads state to decide whether to advance, so it needs every other system's mutations for the
  frame to have already landed.
- Does not gate or pause `workload-spawn`/`resource`/etc. — the demand clock and offer cadence
  run normally throughout, so the `accept-offer` step waits on the real spawn timer rather than
  a scripted one.
