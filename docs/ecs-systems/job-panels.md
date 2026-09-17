# job-panels

`src/ecs/systems/job-panels.ts` — `createJobPanelsSystem(world, input, renderer, controlled)`,
plus exported helpers used by `input.ts`, `hud.ts`, `rack-panel.ts`, and `shop.ts`

## Purpose

Owns the offers panel (jobs available to accept, toggled by `O`) and the jobs panel (every
accepted job — unplaced + running — with full stats, toggled by `J`). Both replace what used to
be always-docked HUD chrome (a left column of offer cards, a right corner workload panel) with
centered modals the player opens on demand — see `.plans/job-panels.md`.

## Mutual exclusion — switching, not blocking

Only one of {offers panel, jobs panel, rack panel, shop panel} is ever open at a time, and
pressing a hotkey for a *different* one always switches straight to it rather than being
ignored:

- The `O`/`J` toggle keys still no-op while a maintenance task is active (`maintenanceTaskActive`)
  — same guard shape as the build-mode number keys, since that represents an already-committed
  action (walking to install/repair/decommission something paid for up front) a hotkey shouldn't
  silently interrupt.
- Otherwise, `toggleOffersPanel`/`toggleJobsPanel` call `closeOtherModals` before opening: it
  closes the rack panel (`rack-panel.ts`'s `closeRackPanel`, unconditionally — any mode, arrived
  or not, so a dispatching-but-not-yet-arrived panel can't pop up later stacked on top of
  whichever panel the player switched to) and the shop (removing `ShopOpen` and calling
  `shop.ts`'s `dismissShop()` so proximity doesn't reopen it the very next frame).
- Opening one of these two panels also closes the other (`closeJobPanels`, called at the start of
  `toggleOffersPanel`/`toggleJobsPanel`) — pressing `O` while the jobs panel is open switches to
  offers, and vice versa.
- `rack-panel.ts` (both open paths — left-click dispatch and right-click view) and `shop.ts`
  (proximity open) each call `closeJobPanels` before opening, so a rack click or walking into
  shop range also wins over an already-open offers/jobs panel — the reverse direction from
  `closeOtherModals` above. Between them, every one of these four "modals" now yields to
  whichever the player asks for next, by click, proximity, or hotkey.
- This makes `job-panels.ts` and `rack-panel.ts`/`shop.ts` mutually import each other
  (`closeOtherModals` imports `closeRackPanel`/`dismissShop`; `rack-panel.ts`/`shop.ts` import
  `closeJobPanels`). Safe here because every use on both sides is inside a function body, called
  well after both modules have finished loading — never at module top level, which is the only
  shape of circular ESM import that actually breaks.

## Offers panel

Read/write, mirrors the old docked column almost exactly, just moved into a scrollable modal
(`ui/layout.ts`'s `getOffersModal*` functions): each offer still renders and hit-tests at its own
stable `Offer.slot` rather than a position in a sorted-by-id array — the fix from
`.plans/playtest-findings.md` F6 (a button's position must never silently shift under the pointer
between the frame a modal was drawn and the frame a click on it is processed) still applies to a
modal list exactly as much as it did to a fixed HUD column. `handleOffersModalClick` (called from
`input.ts`'s click-priority chain once `isOffersModalOpen` is true) hit-tests the close button,
then each offer's accept/decline buttons in content space (accounting for scroll, same
`toContentSpace` idea as `rack-panel.ts`), calling straight into `dispatch.ts`'s `acceptOffer`/
`declineOffer`.

## Jobs panel

Read-only besides its close button — no per-row buttons, so no stable-ordering requirement:
`jobPanelCounts` and `hud.ts`'s own draw loop both just sort by id, UNPLACED then ACTIVE, same
grouping the old docked corner panel used. The only reason this module needs to know about it at
all is content height (`getJobsModalContentHeight(pendingCount, activeCount)`), shared between
this module's scroll clamp and `hud.ts`'s draw loop so the two never disagree about how tall the
content actually is.

## Scrolling

Mouse wheel only (no drag-to-scroll, unlike the rack panel) — reuses `ui/scroll.ts`'s
`maxScrollOffset`/`clampScrollOffset` (factored out of `rack-panel.ts`'s own `maxRackScroll`,
which now just points at the same shared function). Clamped every frame, not just on wheel
input, since content height can change under an open panel (an offer gets accepted, a job
completes) between wheel events — same reasoning as `rack-panel.ts`'s own scroll clamp.

## Notes

- Drawing lives in `hud.ts` (`drawOffersModal`/`drawJobsModal`), not here — same split of
  responsibility `rack-panel.ts`/`render.ts` use (interaction vs. presentation).
- `getGameViewportRect` and `pointerInHud` (`ui/layout.ts`) no longer reserve/block a docked
  offers/workload column — that chrome doesn't exist anymore. The offers/jobs count now shows as
  a small hint badge in the top bar (`hud.ts`'s `drawTopBar`) instead.
- `ecs/systems/camera.ts`'s `canPanCamera` and `ecs/systems/input.ts`'s build-mode number keys
  both also check `isOffersModalOpen`/`isJobsModalOpen`, same treatment as the rack/shop panel
  checks already there.
