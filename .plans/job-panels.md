# Job panels: offers modal + accepted-jobs modal

## Goal

Two requests:
1. The "available jobs to accept" (currently the always-visible offer cards docked on the
   left) move into a separate panel, opened/closed with a keypress.
2. A new panel shows every currently-accepted job (unplaced + running) with full stats
   (progress, time left, pay, demands, penalty) — scrollable if it overflows.

## Keys

- `O` — toggle the **Offers** panel (jobs available to accept).
- `J` — toggle the **Jobs** panel (accepted jobs — unplaced + running — and their full stats).

Chosen because neither collides with existing bindings (WASD pan, Space recenter, Escape,
digit keys for build mode).

## Design

Both panels are centered modal overlays, following the existing rack-panel/shop-panel shape
(dim the floor, absorb every click while open, closed via an explicit × or Escape) rather than
a third, novel interaction pattern — reuse first.

- **Mutually exclusive with each other and with the rack/shop panels.** Opening one closes the
  other (own toggle keys), and the rack panel / shop auto-close whichever of these is open when
  *they* open (proximity for the shop, click for the rack) so only one modal is ever visible.
  The `O`/`J` keys themselves are ignored while a maintenance task is active or the rack/shop
  modal is already open — same guard style as the existing build-mode number keys.
- **Offers panel**: reuses each `Offer`'s own stable `slot` (0..MAX_OFFERS-1) for its vertical
  position in the list, exactly like the docked cards did — this is what stops a button's
  position silently shifting under the pointer between the frame the panel was drawn and the
  frame a click on it is processed (see `.plans/playtest-findings.md` F6, the reason `Offer.slot`
  exists at all). No new ordering scheme needed.
- **Jobs panel**: read-only (no buttons besides ×/Escape), so it just lists UNPLACED then ACTIVE
  workloads sorted by id, same grouping the old docked corner panel used, but never truncated —
  every row is shown, panel scrolls instead of hiding rows past a budget.
- **Scrolling**: mouse wheel only (not drag-to-scroll) — matches the shop panel's existing
  scope (no scroll support at all previously) rather than fully duplicating the rack panel's
  touch drag-scroll, which is more machinery than either of these panels' content depth (offers
  capped at `MAX_OFFERS`, a handful of jobs) currently justifies. Scroll clamping reuses a new
  shared `maxScrollOffset` helper (`src/ui/scroll.ts`) factored out of `rack-panel.ts`'s
  `maxRackScroll`, rather than a third copy of the same formula.
- Small hint badges land in the top bar (`hud.ts`'s `drawTopBar`, which already has a
  right-truncating list of items) — "N offers [O]" / "N jobs [J]" — so the player has a
  reason to know the panels exist now that they're not glanceable by default.

## Side effects

- `getGameViewportRect` no longer reserves the old docked offer/workload-panel columns (they
  don't exist anymore) — the play area grows to fill the canvas below the top bar.
- `pointerInHud` drops its offer-panel/workload-panel region checks (and the `offerCount`
  param) — only the top bar itself blocks clicks now.
- Dead code removed: `getOfferCardRect`, `getOfferButtonRect`, `getOffersPanelRect`,
  `getWorkloadPanelRect`, `getWorkloadRowRect`, `OFFER_CARD_WIDTH`, `HUD_PANEL_WIDTH`,
  `HUD_ROW_HEIGHT`, `HUD_PANEL_MAX_ROWS` and the corresponding docked-drawing code in `hud.ts`.
- Tutorial step `accept-offer`'s body text updated to say "press O" instead of "offers appear
  on the left".

## Files

- `src/ui/scroll.ts` (new) — `maxScrollOffset`.
- `src/ecs/components.ts` — `OffersPanelOpen`/`OffersPanelScroll`, `JobsPanelOpen`/
  `JobsPanelScroll` + stores.
- `src/ui/layout.ts` — offers-modal and jobs-modal rect functions; viewport/pointerInHud
  updates; dead docked-panel rect functions removed.
- `src/ecs/systems/job-panels.ts` (new) — `createJobPanelsSystem`: key toggles, Escape close,
  wheel-scroll clamping, `closeJobPanels` (called by shop.ts/rack-panel.ts), offer/job hit-test
  helpers for input.ts.
- `src/ecs/systems/rack-panel.ts` — re-export `maxRackScroll` from the shared helper; close job
  panels when a rack panel opens.
- `src/ecs/systems/shop.ts` — close job panels when the shop opens.
- `src/ecs/systems/hud.ts` — replace docked offers/workload drawing with the two modals + top
  bar hint badges.
- `src/ecs/systems/input.ts` — remove the old always-on offer-button hit-test; add the new
  modals to the click-priority chain (absorb while open); guard the O/J keys.
- `src/ecs/systems/tutorial.ts` — update `accept-offer` step copy.
- `src/main.ts` — wire `createJobPanelsSystem` into `updateSystems`.
- `docs/ecs-systems/` — new `job-panels.md`, README update, cross-references in `hud.md`,
  `input.md`, `rack-panel.md`, `shop.md`.
