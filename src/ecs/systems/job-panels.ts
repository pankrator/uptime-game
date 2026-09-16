// Offers panel (the counterpart to the old always-docked column of offer cards) and the jobs
// panel (every accepted job's full stats) — two toggled modals, opened by 'o'/'j' and mutually
// exclusive with each other and with the rack/shop panels (see .plans/job-panels.md). This
// module owns both panels' lifecycle: key toggles, Escape close, wheel-scroll clamping, and the
// click hit-testing input.ts calls into while a panel is open — the same split of responsibility
// rack-panel.ts uses (interaction here, drawing in hud.ts).
import { type World, type EntityId } from '../world';
import {
  offersPanelOpens,
  offersPanelScrolls,
  jobsPanelOpens,
  jobsPanelScrolls,
  maintenanceTasks,
  openRackPanels,
  shopOpens,
  offers,
  workloads,
} from '../components';
import { acceptOffer, declineOffer } from '../dispatch';
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

export function closeJobPanels(world: World, controlled: EntityId): void {
  world.removeComponent(offersPanelOpens, controlled);
  world.removeComponent(offersPanelScrolls, controlled);
  world.removeComponent(jobsPanelOpens, controlled);
  world.removeComponent(jobsPanelScrolls, controlled);
}

export function isOffersModalOpen(world: World, controlled: EntityId): boolean {
  return world.getComponent(offersPanelOpens, controlled) !== undefined;
}

export function isJobsModalOpen(world: World, controlled: EntityId): boolean {
  return world.getComponent(jobsPanelOpens, controlled) !== undefined;
}

// A maintenance task or another modal (rack/shop) already claims the click-priority chain the
// same way build mode's number keys are guarded in input.ts — the offers/jobs toggle keys are
// ignored under the same conditions so opening one of these panels can never race an
// in-progress interaction elsewhere. See rack-panel.ts/shop.ts's own closeJobPanels calls for
// the reverse direction (those two always win over an already-open offers/jobs panel).
function otherModalBlocking(world: World, controlled: EntityId): boolean {
  if (world.getComponent(maintenanceTasks, controlled)) return true;
  const rackPanel = world.getComponent(openRackPanels, controlled);
  if (rackPanel && (rackPanel.mode === 'viewing' || rackPanel.arrived)) return true;
  if (world.getComponent(shopOpens, controlled)) return true;
  return false;
}

function toggleOffersPanel(world: World, controlled: EntityId): void {
  if (otherModalBlocking(world, controlled)) return;
  const wasOpen = isOffersModalOpen(world, controlled);
  closeJobPanels(world, controlled);
  if (wasOpen) return;
  world.addComponent(offersPanelOpens, controlled, { open: true });
  world.addComponent(offersPanelScrolls, controlled, { offsetPx: 0 });
}

function toggleJobsPanel(world: World, controlled: EntityId): void {
  if (otherModalBlocking(world, controlled)) return;
  const wasOpen = isJobsModalOpen(world, controlled);
  closeJobPanels(world, controlled);
  if (wasOpen) return;
  world.addComponent(jobsPanelOpens, controlled, { open: true });
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
      acceptOffer(world, offerId);
      return;
    }
    if (
      pointerInRect(
        contentPoint,
        getOffersModalButtonRect(offer.slot, 'decline', canvasWidth, canvasHeight),
      )
    ) {
      audio.play('uiClick');
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
      // Wheel-scroll clamping — only one of the two panels can be open at a time (see
      // otherModalBlocking/closeJobPanels), so at most one branch below ever consumes the
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
