# Guided tutorial

## Goal

A first-time player gets a short, interactive walkthrough of the core loop (move, place a
rack, install a machine, open the rack panel, accept a contract, dispatch it) played out in
the real game world — not a separate sandboxed session. Finishing (or skipping) the
tutorial just dismisses the guidance overlay; the rack/machine/wallet/workload state the
player built during it carries straight into the real game, because it *is* the real game.

## Design (ECS-first, per CLAUDE.md)

- New component `TutorialProgress` (facility singleton, `components.ts`): `stepId`,
  `moveOrigin` (captured once at start, used to detect the 'move' step by distance
  travelled), `skipped`.
- New system `src/ecs/systems/tutorial.ts`: owns step-advance logic only (mirrors
  `shop.ts`'s split — state/logic here, drawing in `hud.ts`, clicks in `input.ts`).
  Exports `TUTORIAL_STEPS`, `startTutorial`, `createTutorialSystem`, `advanceTutorial`,
  `skipTutorial`, `isTutorialActionStep`.
- Each step's completion is a pure read of existing components already used elsewhere
  (first rack via `rackSlots`, first machine via `machines`, panel opened via
  `openRackPanels`, first workload via `workloads`, first placement via `placedOns`) — no
  gating of other systems, no new mutation paths into gameplay state.
- Drawing: one banner, always-on-screen, drawn by `hud.ts` (matches its "always-on-screen
  overlay" role) via rects added to `ui/layout.ts` (same pattern as every other panel).
- Clicks (skip link, and the welcome/done step's primary button) are handled in
  `input.ts`'s existing priority chain, checked early like the mute button — always
  reachable regardless of build mode/panels — since the banner sits above everything else.
- No changes to `workload-spawn`/`resource`/etc. — the demand clock and offer cadence run
  normally throughout, so the tutorial's "wait for a contract" step uses the real spawn
  timer instead of a scripted fake one.

## Steps

`welcome -> move -> build-rack -> install-machine -> open-rack-panel -> visit-shop ->
accept-offer -> place-workload -> done`

`welcome` and `done` require an explicit button click to advance/dismiss; every other step
auto-advances the instant its world-state condition is met. `visit-shop` is the one
exception to "pure read of existing components": there's no component for "a purchase
happened", so `shop.ts`'s `buy()` now returns whether it actually applied a purchase, and
`input.ts`'s buy-button handler calls `tutorial.ts`'s `recordShopPurchase` on success —
still no gating of `shop.ts` itself, just a truthful return value it didn't have before.
