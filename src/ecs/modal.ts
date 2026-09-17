// Single source of truth for "which modal is open" (F6, .plans/design-review.md). The rule —
// exactly one of {rack panel, shop, offers, jobs} is visible at a time — used to be enforced by
// five modules calling into each other (rack-panel.ts, shop.ts and job-panels.ts each importing
// each other's close functions), which produced two real import cycles:
//
//   rack-panel.ts -> job-panels.ts -> rack-panel.ts
//   shop.ts       -> job-panels.ts -> shop.ts
//
// Each panel module registers its own close function here once (registerModalCloser) instead of
// importing the other panels' close functions directly, so this module never imports any of
// them and the cycles disappear. input.ts's click-priority chain and render.ts's draw-priority
// chain both read activeModal() instead of maintaining their own hand-ordered `if` chains that
// could silently disagree about which panel is showing.
import { type World, type EntityId } from './world';
import { openRackPanels, shopOpens, offersPanelOpens, jobsPanelOpens } from './components';

export type ModalKind = 'rack' | 'shop' | 'offers' | 'jobs';

// Priority order — first match wins. Mirrors input.ts's click chain and render.ts's draw chain
// before this module existed: offers/jobs (toggled modals) outrank the rack panel, which
// outranks the shop.
const MODAL_KINDS: ModalKind[] = ['offers', 'jobs', 'rack', 'shop'];

type CloseFn = (world: World, player: EntityId) => void;

const closers: Partial<Record<ModalKind, CloseFn>> = {};

// Called once per panel module (at import time) to register how to close it. Keeps this module
// free of any dependency on rack-panel.ts/shop.ts/job-panels.ts.
export function registerModalCloser(kind: ModalKind, close: CloseFn): void {
  closers[kind] = close;
}

// Which modal is currently visible/clickable, or null. The rack panel only counts once actually
// on screen — viewing mode, or dispatching mode after arrival — the same "visible" gate
// rack-panel.ts's own System and render.ts's draw path already applied ad hoc.
export function activeModal(world: World, player: EntityId): ModalKind | null {
  if (world.getComponent(offersPanelOpens, player)) return 'offers';
  if (world.getComponent(jobsPanelOpens, player)) return 'jobs';
  const rackPanel = world.getComponent(openRackPanels, player);
  if (rackPanel && (rackPanel.mode !== 'dispatching' || rackPanel.arrived)) return 'rack';
  if (world.getComponent(shopOpens, player)) return 'shop';
  return null;
}

// Closes every OTHER registered modal, so opening one always wins over whichever else was open —
// the single place that bookkeeping now lives, instead of every opener calling every other
// panel's close function by hand.
export function closeOtherModals(world: World, player: EntityId, keep: ModalKind): void {
  for (const kind of MODAL_KINDS) {
    if (kind === keep) continue;
    closers[kind]?.(world, player);
  }
}
