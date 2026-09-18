// Single source of truth for "which modal is open" (F6, .plans/design-review.md, plus a
// follow-up simplification). The rule — exactly one of {rack panel, shop, offers, jobs} is
// visible at a time — used to be enforced by four independent components (OpenRackPanel,
// ShopOpen, OffersPanelOpen, JobsPanelOpen), each optionally present on the player at once, with
// mutual exclusion upheld only by every opener remembering to close the other three
// (closeOtherModals). activeModal() had to check all four by hand to find out which one, if any,
// was actually open.
//
// components.ts's ActiveModal is now a single tagged-union component, so AT MOST ONE modal can
// ever be recorded as open — it's a type error to represent two at once — and activeModal() is
// one read. openModal() replaces closeOtherModals(): opening a modal is a single addComponent
// that overwrites whatever was there, after running the PREVIOUS kind's registered closer (if
// it's actually a different kind) so it can free its own satellite state (scroll position, drag
// state, confirm windows).
//
// Each panel module still registers its own close function here (registerModalCloser) instead of
// importing the other panels' close functions directly, so this module never imports any of
// them and the import cycles F6 fixed (rack-panel.ts <-> job-panels.ts, shop.ts <->
// job-panels.ts) stay fixed.
import { type World, type EntityId } from './world';
import { activeModals, type ActiveModal } from './components';

export type ModalKind = ActiveModal['kind'];

type CloseFn = (world: World, player: EntityId) => void;

const closers: Partial<Record<ModalKind, CloseFn>> = {};

// Called once per panel module (at import time) to register how to close it. Keeps this module
// free of any dependency on rack-panel.ts/shop.ts/job-panels.ts.
export function registerModalCloser(kind: ModalKind, close: CloseFn): void {
  closers[kind] = close;
}

// Which modal is currently visible/clickable, or null. The rack panel only counts once actually
// on screen — viewing mode, or dispatching mode after arrival — the same "visible" gate
// rack-panel.ts's own System and render.ts's draw path apply.
export function activeModal(world: World, player: EntityId): ModalKind | null {
  const modal = world.getComponent(activeModals, player);
  if (!modal) return null;
  if (modal.kind === 'rack' && modal.mode === 'dispatching' && !modal.arrived) return null;
  return modal.kind;
}

// Opens `modal`, replacing whatever else was open — the single place that bookkeeping lives now,
// instead of every opener calling every other panel's close function by hand. Runs the PREVIOUS
// modal's registered closer first (so it frees its own satellite state), but only if it's
// actually a different kind: re-opening/promoting the same kind in place (e.g.
// openOrPromoteRackPanel switching mode on the same or a different rack) must not tear down and
// rebuild what's already there — that distinction used to be closeOtherModals's `keep` param,
// skipping its own kind; here it falls out of comparing `current.kind` to `modal.kind` directly.
export function openModal(world: World, player: EntityId, modal: ActiveModal): void {
  const current = world.getComponent(activeModals, player);
  if (current && current.kind !== modal.kind) {
    closers[current.kind]?.(world, player);
  }
  world.addComponent(activeModals, player, modal);
}
