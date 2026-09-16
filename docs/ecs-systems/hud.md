# hud

`src/ecs/systems/hud.ts` — `createHudSystem(world, renderer, controlled, facility, audio, camera)`

## Purpose

Draws the always-on-screen overlay (top status bar, mute/recenter buttons, tutorial banner) plus
the offers and jobs modals when [job-panels](./job-panels.md) has them open. Presentation only,
no component writes.

## Structure

- `drawTopBar` — money, power draw/capacity, cooling draw/capacity, reputation, per-trait
  facility capacity bars (CPU/RAM/storage shown separately — see the D5 comment: compute
  alone hid RAM/storage pressure that could bottleneck placement even with CPU headroom),
  offers/jobs hint badges (the only always-visible sign those two panels exist, now that
  they're toggled rather than docked — see .plans/job-panels.md), inventory summary
  (owned-but-unplaced stock), and personal-best counters
- `drawOffersModal` / `drawOfferCard` — a centered, scrollable modal (only drawn while
  `isOffersModalOpen`) listing every open `Offer`, dimmed via `anyServerFits` when no online
  server currently has enough free capacity for it (informative only — never blocks accept,
  since the player may be about to install a bigger box). Each card still renders at its own
  stable `Offer.slot` — see [job-panels](./job-panels.md)'s note on why that matters even in a
  scrollable list.
- `drawJobsModal` / `drawActiveJobRow` / `drawPendingJobRow` — a centered, scrollable modal
  (only drawn while `isJobsModalOpen`) listing every accepted job (unplaced + running) with
  full stats: progress, time left, pay, full demand breakdown, penalty, recurring-cycle count.
  Never truncated (unlike the old docked corner panel this replaced) — it scrolls instead.
- `drawTutorialBanner` — the guided-tutorial step banner, drawn last (topmost) so it stays
  legible over the rack/shop/offers/jobs panels' full-screen dim; see [tutorial](./tutorial.md)
  for the step-advance logic this only reads

## Notes

- `anyServerFits` duplicates a capacity check rather than reusing `dispatch.ts`'s
  `checkPlacement` because it needs a "does ANY server fit" existence check across all
  servers, not a single-server validity check — different question, not shared logic.
- Offers/jobs modal click hit-testing (close buttons, offer accept/decline) is done in
  [job-panels](./job-panels.md) (`handleOffersModalClick`/`handleJobsModalClick`), called from
  `input.ts`, against the same rects this file draws (`ui/layout.ts`'s `getOffersModal*`/
  `getJobsModal*` functions) — keep the two in sync if either modal's layout changes.
- Runs last in `renderSystems`, on top of everything `render.ts` draws. See the
  [update order](./README.md#update-order).
- Also draws the mute button (`drawMuteButton`, `getMuteButtonRect`); the click itself is
  hit-tested in `input.ts`, ahead of everything else in the priority chain — see
  [audio](./audio.md).
