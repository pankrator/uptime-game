// Single source of truth for "which modal is open". At most one of {rack panel, shop, offers,
// jobs} is ever open: ActiveModal is a tagged-union component, so representing two at once is a
// type error, and activeModal() is one read. openModal() overwrites whatever was previously
// open with a single addComponent, after running the PREVIOUS kind's registered closer (if it's
// actually a different kind) so it can free its own satellite state (scroll position, drag
// state, confirm windows).
//
// Each panel module registers its own close function here (registerModalCloser) instead of this
// module importing the other panels' close functions directly, so this module never imports any
// of them and no import cycle forms between rack-panel.ts, shop.ts, and job-panels.ts.
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

// Opens `modal`, replacing whatever else was open. Runs the PREVIOUS modal's registered closer
// first (so it frees its own satellite state), but only if it's actually a different kind:
// re-opening/promoting the same kind in place (e.g. openOrPromoteRackPanel switching mode on the
// same or a different rack) must not tear down and rebuild what's already there.
export function openModal(world: World, player: EntityId, modal: ActiveModal): void {
  const current = world.getComponent(activeModals, player);
  if (current && current.kind !== modal.kind) {
    closers[current.kind]?.(world, player);
  }
  world.addComponent(activeModals, player, modal);
}
