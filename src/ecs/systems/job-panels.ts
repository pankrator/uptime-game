// Offers panel (the counterpart to the old always-docked column of offer cards) and the jobs
// panel (every accepted job's full stats) — two toggled modals, opened by 'o'/'j' and mutually
// exclusive with each other and with the rack/shop panels (see .plans/job-panels.md). Pressing
// O/J while another modal is open SWITCHES to it — closes whichever is open (rack panel, shop,
// or the other of these two) and opens the one just requested, rather than doing nothing. This
// module owns both panels' lifecycle: key toggles, Escape close, wheel-scroll clamping, and the
// click hit-testing input.ts calls into while a panel is open — the same split of responsibility
// rack-panel.ts uses (interaction here, drawing in hud.ts).
import { type World, type EntityId } from '../world';
import {
  activeModals,
  offersPanelScrolls,
  jobsPanelScrolls,
  maintenanceTasks,
  offers,
  workloads,
  acceptConfirms,
  machines,
  installedIns,
  powereds,
  serverCapacities,
  type Offer,
} from '../components';
import { acceptOffer, declineOffer } from '../dispatch';
import { fits } from '../traits';
import { registerModalCloser, openModal } from '../modal';
import {
  getOffersModalContentRect,
  getOffersModalFullContentHeight,
  getOffersModalCloseButtonRect,
  getOffersModalButtonRect,
  getJobsModalContentRect,
  getJobsModalContentHeight,
  getJobsModalCloseButtonRect,
  pointerInRect,
} from '../../ui/layout';
import { clampScrollOffset } from '../../ui/scroll';
import { type InputState } from '../../input';
import { type Renderer } from '../../rendering';
import { type Audio } from '../../audio';
import { type System } from './system';

// .plans/playtest-findings.md F3: accepting a contract nothing can currently serve used to be a
// single click into a doomed deadline. A SERVABLE offer still accepts on the first click,
// exactly as before — this only gates the unservable case, same "second click on the same
// button, within a window, confirms" shape as rack-panel.ts's DecommissionConfirm.
const ACCEPT_CONFIRM_WINDOW_MS = 3000;

// Whether ANY online, installed server currently has enough free capacity for these demands —
// used both to dim an offer the player can't currently serve (hud.ts, which imports this rather
// than defining its own — a second, possibly-diverging copy) and to gate the accept-confirm
// check below. Informative-dimming aside, this never blocks accept outright: the player may be
// about to install a bigger box, so an unservable offer is still acceptable, just double-checked.
export function anyServerFits(world: World, demands: Offer['demands']): boolean {
  return world.query(machines, installedIns, powereds, serverCapacities).some((id) => {
    if (!world.getComponent(powereds, id)!.online) return false;
    const capacity = world.getComponent(serverCapacities, id)!;
    return fits(demands, capacity.free);
  });
}

// Called unconditionally at the top of both toggle functions below, regardless of which modal
// (if any) is actually active — so it only touches activeModals when it's actually one of ITS
// OWN two kinds ('offers' or 'jobs'); otherwise it would wipe out a rack/shop panel's state
// without running that panel's own closer. The offers/jobs-specific component removals below are
// always safe to call unconditionally (removing an absent component is a no-op).
export function closeJobPanels(world: World, controlled: EntityId): void {
  const modal = world.getComponent(activeModals, controlled);
  if (modal && (modal.kind === 'offers' || modal.kind === 'jobs')) {
    world.removeComponent(activeModals, controlled);
  }
  world.removeComponent(offersPanelScrolls, controlled);
  world.removeComponent(jobsPanelScrolls, controlled);
  world.removeComponent(acceptConfirms, controlled);
}

// Registered as the closer for both 'offers' and 'jobs' — the two panels are already mutually
// exclusive with each other (toggleOffersPanel/toggleJobsPanel below), so one function closing
// both is exactly as correct as two that would always agree.
registerModalCloser('offers', closeJobPanels);
registerModalCloser('jobs', closeJobPanels);

export function isOffersModalOpen(world: World, controlled: EntityId): boolean {
  return world.getComponent(activeModals, controlled)?.kind === 'offers';
}

export function isJobsModalOpen(world: World, controlled: EntityId): boolean {
  return world.getComponent(activeModals, controlled)?.kind === 'jobs';
}

// A maintenance task represents an already-committed action (walking to install/repair/
// decommission something paid for up front) — same "don't silently interrupt" reasoning as the
// build-mode number keys' own guard in input.ts. This is the only thing that still blocks the
// O/J toggle outright; every other modal below yields to whichever the player asks for next.
function maintenanceTaskActive(world: World, controlled: EntityId): boolean {
  return world.getComponent(maintenanceTasks, controlled) !== undefined;
}

function toggleOffersPanel(world: World, controlled: EntityId): void {
  if (maintenanceTaskActive(world, controlled)) return;
  const wasOpen = isOffersModalOpen(world, controlled);
  closeJobPanels(world, controlled);
  if (wasOpen) return;
  // Pressing O always switches straight to the offers panel instead of doing nothing, closing
  // whichever other modal (rack panel, shop) was open — see ../modal.ts.
  openModal(world, controlled, { kind: 'offers' });
  world.addComponent(offersPanelScrolls, controlled, { offsetPx: 0 });
}

function toggleJobsPanel(world: World, controlled: EntityId): void {
  if (maintenanceTaskActive(world, controlled)) return;
  const wasOpen = isJobsModalOpen(world, controlled);
  closeJobPanels(world, controlled);
  if (wasOpen) return;
  openModal(world, controlled, { kind: 'jobs' });
  world.addComponent(jobsPanelScrolls, controlled, { offsetPx: 0 });
}

// Job counts driving the jobs panel's content height — shared between this module's scroll
// clamp and hud.ts's draw loop so the two can never disagree about how tall the content actually
// is (see getJobsModalContentHeight's own comment in ui/layout.ts).
export function jobPanelCounts(world: World): { pendingCount: number; activeCount: number } {
  let pendingCount = 0;
  let activeCount = 0;
  for (const id of world.query(workloads)) {
    if (world.getComponent(workloads, id)!.state === 'running') activeCount += 1;
    else pendingCount += 1;
  }
  return { pendingCount, activeCount };
}

// Click hit-testing while the offers modal is open — called from input.ts's click-priority
// chain, which treats this (like the rack/shop panels) as a modal that absorbs every click
// while visible. Only invoked once isOffersModalOpen() is already known true.
export function handleOffersModalClick(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  facility: EntityId,
  pointer: { x: number; y: number },
  audio: Audio,
): void {
  const canvasWidth = renderer.width;
  const canvasHeight = renderer.height;

  if (pointerInRect(pointer, getOffersModalCloseButtonRect(canvasWidth, canvasHeight))) {
    audio.play('uiClick');
    closeJobPanels(world, controlled);
    return;
  }

  const contentRect = getOffersModalContentRect(canvasWidth, canvasHeight);
  if (!pointerInRect(pointer, contentRect)) return; // clicked the modal chrome — absorbed, no-op

  // Convert to the content's unscrolled coordinate space, same as rack-panel.ts's
  // toContentSpace — getOffersModalButtonRect lays rects out unscrolled.
  const offsetPx = world.getComponent(offersPanelScrolls, controlled)?.offsetPx ?? 0;
  const contentPoint = { x: pointer.x, y: pointer.y + offsetPx };

  for (const offerId of world.query(offers)) {
    const offer = world.getComponent(offers, offerId)!;
    if (
      pointerInRect(
        contentPoint,
        getOffersModalButtonRect(offer.slot, 'accept', canvasWidth, canvasHeight),
      )
    ) {
      audio.play('uiClick');
      // F3: a servable offer accepts on the first click, exactly as before. An unservable one
      // needs a second click within ACCEPT_CONFIRM_WINDOW_MS on the SAME offer's Accept button —
      // same "second click on the same button, within a window, confirms" shape as
      // DecommissionConfirm (rack-panel.ts).
      const confirm = world.getComponent(acceptConfirms, controlled);
      const alreadyConfirming =
        confirm && confirm.offerId === offerId && performance.now() < confirm.expiresAtMs;
      if (anyServerFits(world, offer.demands) || alreadyConfirming) {
        world.removeComponent(acceptConfirms, controlled);
        acceptOffer(world, offerId);
      } else {
        world.addComponent(acceptConfirms, controlled, {
          offerId,
          expiresAtMs: performance.now() + ACCEPT_CONFIRM_WINDOW_MS,
        });
      }
      return;
    }
    if (
      pointerInRect(
        contentPoint,
        getOffersModalButtonRect(offer.slot, 'decline', canvasWidth, canvasHeight),
      )
    ) {
      audio.play('uiClick');
      world.removeComponent(acceptConfirms, controlled);
      declineOffer(world, facility, offerId);
      return;
    }
  }
}

// Click hit-testing while the jobs modal is open — read-only besides the close button, so this
// is much shorter than the offers modal's version above.
export function handleJobsModalClick(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  pointer: { x: number; y: number },
  audio: Audio,
): void {
  const { pendingCount, activeCount } = jobPanelCounts(world);
  const contentHeight = getJobsModalContentHeight(pendingCount, activeCount);
  if (
    pointerInRect(
      pointer,
      getJobsModalCloseButtonRect(renderer.width, renderer.height, contentHeight),
    )
  ) {
    audio.play('uiClick');
    closeJobPanels(world, controlled);
  }
  // Anywhere else on the modal — absorbed, no-op (no other interactive elements).
}

export function createJobPanelsSystem(
  world: World,
  input: InputState,
  renderer: Renderer,
  controlled: EntityId,
): System {
  input.onKeyDown('o', () => toggleOffersPanel(world, controlled));
  input.onKeyDown('j', () => toggleJobsPanel(world, controlled));

  input.onKeyDown('Escape', () => {
    if (isOffersModalOpen(world, controlled) || isJobsModalOpen(world, controlled)) {
      closeJobPanels(world, controlled);
    }
  });

  return {
    update() {
      // Expire an unconfirmed accept-confirm click (F3: the confirm window, not a modal) —
      // same per-frame expiry rack-panel.ts's own System does for DecommissionConfirm. Runs
      // unconditionally (not gated on the offers modal being open) so a confirm window started
      // just before the player closed the panel still times out on schedule.
      const acceptConfirm = world.getComponent(acceptConfirms, controlled);
      if (acceptConfirm && performance.now() >= acceptConfirm.expiresAtMs) {
        world.removeComponent(acceptConfirms, controlled);
      }

      // Wheel-scroll clamping — only one of the two panels can be open at a time (see
      // toggleOffersPanel/toggleJobsPanel/closeJobPanels), so at most one branch below ever consumes the
      // frame's wheel delta. Clamped every frame (not just on wheel input), same reasoning as
      // rack-panel.ts's scroll: content height can change under an open panel (an offer gets
      // accepted, a job completes) between wheel events. Only scrolls while the pointer is over
      // the content viewport, same gate rack-panel.ts uses, so wheeling elsewhere doesn't hijack
      // input meant for the rest of the page.
      if (isOffersModalOpen(world, controlled)) {
        const scroll = world.getComponent(offersPanelScrolls, controlled) ?? { offsetPx: 0 };
        if (!world.getComponent(offersPanelScrolls, controlled)) {
          world.addComponent(offersPanelScrolls, controlled, scroll);
        }
        const contentRect = getOffersModalContentRect(renderer.width, renderer.height);
        const pointer = input.getPointerPosition();
        const wheelDeltaY = input.consumeWheelDeltaY();
        if (wheelDeltaY !== 0 && pointer && pointerInRect(pointer, contentRect)) {
          scroll.offsetPx += wheelDeltaY;
        }
        scroll.offsetPx = clampScrollOffset(
          scroll.offsetPx,
          getOffersModalFullContentHeight(),
          contentRect.height,
        );
      } else if (isJobsModalOpen(world, controlled)) {
        const scroll = world.getComponent(jobsPanelScrolls, controlled) ?? { offsetPx: 0 };
        if (!world.getComponent(jobsPanelScrolls, controlled)) {
          world.addComponent(jobsPanelScrolls, controlled, scroll);
        }
        const { pendingCount, activeCount } = jobPanelCounts(world);
        const contentHeight = getJobsModalContentHeight(pendingCount, activeCount);
        const contentRect = getJobsModalContentRect(renderer.width, renderer.height, contentHeight);
        const pointer = input.getPointerPosition();
        const wheelDeltaY = input.consumeWheelDeltaY();
        if (wheelDeltaY !== 0 && pointer && pointerInRect(pointer, contentRect)) {
          scroll.offsetPx += wheelDeltaY;
        }
        scroll.offsetPx = clampScrollOffset(scroll.offsetPx, contentHeight, contentRect.height);
      }
    },
  };
}
