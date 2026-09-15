# hud

`src/ecs/systems/hud.ts` — `createHudSystem(world, renderer, facility)`

## Purpose

Draws the always-on-screen overlay: top status bar, the active/pending workload list, and
the incoming offers panel. Presentation only, no component writes.

## Structure

- `drawTopBar` — money, power draw/capacity, cooling draw/capacity, reputation, per-trait
  facility capacity bars (CPU/RAM/storage shown separately — see the D5 comment: compute
  alone hid RAM/storage pressure that could bottleneck placement even with CPU headroom),
  inventory summary (owned-but-unplaced stock), and personal-best counters
- `drawWorkloadPanel` — two sections: PENDING (accepted-but-unplaced, always shown in
  full since they're deadline-timed and self-expire so the list can't grow unbounded) and
  ACTIVE (capped/truncated against remaining vertical budget, since running workloads
  don't self-limit the same way)
- `drawOfferCard` / `drawOffersPanel` — one card per open `Offer`, dimmed via
  `anyServerFits` when no online server currently has enough free capacity for it
  (informative only — never blocks accept, since the player may be about to install a
  bigger box)

## Notes

- `anyServerFits` duplicates a capacity check rather than reusing `dispatch.ts`'s
  `checkPlacement` because it needs a "does ANY server fit" existence check across all
  servers, not a single-server validity check — different question, not shared logic.
- Offer card hit-testing (accept/decline buttons) is done in `input.ts`
  (`hitTestOfferButtons`) against the same rects this file draws
  (`ui/layout.ts`'s `getOfferButtonRect`) — keep the two in sync if offer card layout
  changes.
- Runs last in `renderSystems`, on top of everything `render.ts` draws. See the
  [update order](./README.md#update-order).
