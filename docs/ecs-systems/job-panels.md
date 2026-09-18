# job-panels

`src/ecs/systems/job-panels.ts` — `createJobPanelsSystem(world, input, renderer, controlled)`,
plus exported helpers used by `input.ts`, `hud.ts`, `rack-panel.ts`, and `shop.ts`

## Purpose

Owns the offers panel (jobs available to accept, toggled by `O`) and the jobs panel (every
accepted job — unplaced + running — with full stats, toggled by `J`). Both replace what used to
be always-docked HUD chrome (a left column of offer cards, a right corner workload panel) with
centered modals the player opens on demand — see `.plans/job-panels.md`.

## Mutual exclusion — switching, not blocking

Only one of {offers panel, jobs panel, rack panel, shop panel} can ever be recorded as open at a
time — `ActiveModal` (`components.ts`) is a single tagged-union component, not four independent
ones, so this isn't a convention every opener has to remember to uphold, it's a type error to
represent two at once. `ecs/modal.ts` owns this: `activeModal(world, player)` reads it (with the
rack panel's own visibility gate — dispatching-but-not-arrived doesn't count), and
`openModal(world, player, modal)` is the only way to open one, replacing whatever was open. And
pressing a hotkey for a *different* panel always switches straight to it rather than being
ignored:

- The `O`/`J` toggle keys still no-op while a maintenance task is active (`maintenanceTaskActive`)
  — same guard shape as the build-mode number keys, since that represents an already-committed
  action (walking to install/repair/decommission something paid for up front) a hotkey shouldn't
  silently interrupt.
- Otherwise, `toggleOffersPanel`/`toggleJobsPanel` call `closeJobPanels` unconditionally first —
  it only clears `ActiveModal` when it's actually the offers/jobs kind already (so it's safe to
  call even when a rack or shop panel is the one open) — then `openModal({kind: 'offers' | 'jobs'})`
  if the panel wasn't already open. `openModal` runs whatever WAS open's registered closer first
  (`rack-panel.ts`'s `closeRackPanel` — any mode, arrived or not, so a dispatching-but-not-yet-
  -arrived panel can't pop up later stacked on top of whichever panel the player switched to — or
  `shop.ts`'s `closeShop`, which also calls `dismissShop()` so proximity doesn't reopen the shop
  the very next frame), so this one call replaces what used to be a separate `closeOtherModals`
  step.
- The early `closeJobPanels` call also covers "opening one of these two panels closes the other" —
  pressing `O` while the jobs panel is open switches to offers, and vice versa.
- `rack-panel.ts` (both open paths — left-click dispatch and right-click view) and `shop.ts`
  (proximity open) each call `ecs/modal.ts`'s `openModal` too, so a rack click or walking into
  shop range also wins over an already-open offers/jobs panel (via the SAME closer this module
  registers — `registerModalCloser('offers', closeJobPanels)` and `registerModalCloser('jobs',
  closeJobPanels)`). Between them, every one of these four "modals" now yields to whichever the
  player asks for next, by click, proximity, or hotkey.
- Each panel module registers its own closer with `ecs/modal.ts` (`registerModalCloser`) instead
  of importing the other panels' close functions directly, so `job-panels.ts` and
  `rack-panel.ts`/`shop.ts` never import each other at all — no import cycle to reason about.

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
