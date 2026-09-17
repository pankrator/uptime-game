import { BUILDABLES } from '../ecs/components';
import { MAX_OFFERS } from '../ecs/game-data';

export const BUILD_PANEL_MARGIN = 12;
export const BUILD_PANEL_ENTRY_WIDTH = 120;
// 40px — touch-target floor (see .plans/mobile-touch-support.md D4). Desktop mouse users lose
// nothing from the larger button; one shared geometry beats a second, mobile-only layout.
export const BUILD_PANEL_ENTRY_HEIGHT = 40;
export const BUILD_PANEL_ENTRY_GAP = 6;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function pointerInRect(point: { x: number; y: number }, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

// Total height of the build panel's stacked entries — shared with getTutorialBannerRect below,
// which anchors above this panel rather than risk overlapping it.
function getBuildPanelHeight(): number {
  return (
    BUILDABLES.length * BUILD_PANEL_ENTRY_HEIGHT + (BUILDABLES.length - 1) * BUILD_PANEL_ENTRY_GAP
  );
}

export function getBuildPanelEntryRect(index: number, canvasHeight: number): Rect {
  const startY = canvasHeight - BUILD_PANEL_MARGIN - getBuildPanelHeight();
  return {
    x: BUILD_PANEL_MARGIN,
    y: startY + index * (BUILD_PANEL_ENTRY_HEIGHT + BUILD_PANEL_ENTRY_GAP),
    width: BUILD_PANEL_ENTRY_WIDTH,
    height: BUILD_PANEL_ENTRY_HEIGHT,
  };
}

// 44px — touch-target floor (see .plans/mobile-touch-support.md D4), up from 36. Every offset
// below that reads HUD_BAR_HEIGHT (drawTopBar's midY, getGameViewportRect's top, the offers/
// workload panels' y) shifts consistently since none of them hardcode the old value.
export const HUD_BAR_HEIGHT = 44;
export const HUD_PANEL_MARGIN = 12;

export function getHudBarRect(canvasWidth: number): Rect {
  return { x: 0, y: 0, width: canvasWidth, height: HUD_BAR_HEIGHT };
}

// Mute toggle — top-right corner of the HUD bar itself, so it's always reachable regardless
// of build mode/panels (checked first in input.ts's click chain, same as offer buttons).
// 34px fits comfortably within the 44px HUD_BAR_HEIGHT with margin to spare (see D4).
export const MUTE_BUTTON_SIZE = 34;
export const MUTE_BUTTON_MARGIN = 6;

export function getMuteButtonRect(canvasWidth: number): Rect {
  return {
    x: canvasWidth - MUTE_BUTTON_MARGIN - MUTE_BUTTON_SIZE,
    y: (HUD_BAR_HEIGHT - MUTE_BUTTON_SIZE) / 2,
    width: MUTE_BUTTON_SIZE,
    height: MUTE_BUTTON_SIZE,
  };
}

// Recenter camera — only reachable while the camera is manually panned away (WASD, or a drag on
// the floor on touch — see .plans/mobile-touch-support.md D3), the touch equivalent of pressing
// Space. Left of the mute button, same row/size family.
export const RECENTER_BUTTON_WIDTH = 84;
export const RECENTER_BUTTON_GAP = 6;

export function getRecenterButtonRect(canvasWidth: number): Rect {
  const mute = getMuteButtonRect(canvasWidth);
  return {
    x: mute.x - RECENTER_BUTTON_GAP - RECENTER_BUTTON_WIDTH,
    y: mute.y,
    width: RECENTER_BUTTON_WIDTH,
    height: MUTE_BUTTON_SIZE,
  };
}

// Shared centered-modal sizing for the offers/jobs panels below — both are a header + a
// scrollable content region, centered and clamped to the canvas, same shape as the rack/shop
// panels' own (independently laid out) modals above.
function getCenteredRect(
  canvasWidth: number,
  canvasHeight: number,
  width: number,
  height: number,
  padding: number,
): Rect {
  const clampedWidth = Math.min(width, canvasWidth - padding * 2);
  const clampedHeight = Math.min(height, canvasHeight - padding * 2);
  return {
    x: (canvasWidth - clampedWidth) / 2,
    y: (canvasHeight - clampedHeight) / 2,
    width: clampedWidth,
    height: clampedHeight,
  };
}

// Tall enough for title/countdown, demands, pay, and — only on an unservable offer — a "no
// server fits this" warning line above the buttons (see hud.ts's drawOfferCard and
// .plans/playtest-findings.md B2: that warning used to be drawn UNDER the Accept button).
// Servable cards just leave that line's space blank, same as a pending workload row always
// reserving its shortfall line whether or not there's a shortfall to show.
// Was 76, then 96 (.plans/playtest-findings.md B2: gave the "no server fits this" warning its
// own line above the buttons) — grown again by .plans/mobile-touch-support.md D4 (the
// accept/decline buttons sit at the touch-target floor, OFFER_BUTTON_HEIGHT) AND by
// .plans/contract-variety.md step 1/2 (a penalty line, always shown, plus a recurring-contract
// marker when the offer rolled a repeat). Worst case the card's own text runs to an 80px
// offset (penalty + recurring + "no server fits this"); the buttons need
// OFFER_BUTTON_HEIGHT + 6px below that — 132 clears all three with room to spare.
export const OFFER_CARD_HEIGHT = 132;
export const OFFER_CARD_GAP = 8;
export const OFFER_BUTTON_HEIGHT = 32;
export const OFFER_BUTTON_GAP = 6;

// Offers panel — a modal opened by the `O` key (job-panels.ts), replacing the old always-docked
// column of cards (see .plans/job-panels.md). Each offer keeps rendering at its own stable SLOT
// (0..MAX_OFFERS-1, assigned once at spawn — entities.ts's spawnOffer / Offer.slot) rather than
// a position in a sorted-by-id array: positional indexing used to make every other card shift up
// (and the pointer land on the wrong card) the instant an earlier offer expired — see
// .plans/playtest-findings.md F6. That fix carries over unchanged; only the column's screen
// position (docked -> centered modal) and dismissability (always visible -> toggled) changed.
export const OFFERS_MODAL_WIDTH = 460;
export const OFFERS_MODAL_PADDING = 16;
export const OFFERS_MODAL_HEADER_HEIGHT = 34;
export const OFFERS_MODAL_CLOSE_BUTTON_SIZE = 32;

// Sized to the full MAX_OFFERS-slot column regardless of how many offers are currently alive —
// same "generous upper bound, since slots aren't contiguous" reasoning the old docked panel used.
function getOffersModalContentHeight(): number {
  return MAX_OFFERS * OFFER_CARD_HEIGHT + (MAX_OFFERS - 1) * OFFER_CARD_GAP;
}

export function getOffersModalRect(canvasWidth: number, canvasHeight: number): Rect {
  const height =
    OFFERS_MODAL_HEADER_HEIGHT + OFFERS_MODAL_PADDING * 3 + getOffersModalContentHeight();
  return getCenteredRect(
    canvasWidth,
    canvasHeight,
    OFFERS_MODAL_WIDTH,
    height,
    OFFERS_MODAL_PADDING,
  );
}

// The scrollable sub-region inside the modal — everything below the header. Same clip-and
// -translate-by-scroll-offset pattern as the rack panel's content rect.
export function getOffersModalContentRect(canvasWidth: number, canvasHeight: number): Rect {
  const modal = getOffersModalRect(canvasWidth, canvasHeight);
  const top = modal.y + OFFERS_MODAL_PADDING + OFFERS_MODAL_HEADER_HEIGHT + OFFERS_MODAL_PADDING;
  return {
    x: modal.x + OFFERS_MODAL_PADDING,
    y: top,
    width: modal.width - OFFERS_MODAL_PADDING * 2,
    height: modal.y + modal.height - OFFERS_MODAL_PADDING - top,
  };
}

// The full, unclamped content height (mirrors getOffersModalContentHeight — kept as a separate
// exported function so job-panels.ts doesn't need to know MAX_OFFERS itself).
export function getOffersModalFullContentHeight(): number {
  return getOffersModalContentHeight();
}

export function getOffersModalCloseButtonRect(canvasWidth: number, canvasHeight: number): Rect {
  const modal = getOffersModalRect(canvasWidth, canvasHeight);
  return {
    x: modal.x + modal.width - OFFERS_MODAL_PADDING - OFFERS_MODAL_CLOSE_BUTTON_SIZE,
    y:
      modal.y +
      (OFFERS_MODAL_HEADER_HEIGHT - OFFERS_MODAL_CLOSE_BUTTON_SIZE) / 2 +
      OFFERS_MODAL_PADDING / 2,
    width: OFFERS_MODAL_CLOSE_BUTTON_SIZE,
    height: OFFERS_MODAL_CLOSE_BUTTON_SIZE,
  };
}

// `slot` is the offer's own stable slot (see the module comment above) — laid out in unscrolled
// content space; render.ts clips to getOffersModalContentRect and translates by -scroll.
export function getOffersModalCardRect(
  slot: number,
  canvasWidth: number,
  canvasHeight: number,
): Rect {
  const content = getOffersModalContentRect(canvasWidth, canvasHeight);
  return {
    x: content.x,
    y: content.y + slot * (OFFER_CARD_HEIGHT + OFFER_CARD_GAP),
    width: content.width,
    height: OFFER_CARD_HEIGHT,
  };
}

export function getOffersModalButtonRect(
  slot: number,
  kind: 'accept' | 'decline',
  canvasWidth: number,
  canvasHeight: number,
): Rect {
  const card = getOffersModalCardRect(slot, canvasWidth, canvasHeight);
  const buttonWidth = (card.width - OFFERS_MODAL_PADDING - OFFER_BUTTON_GAP) / 2;
  const x =
    kind === 'accept'
      ? card.x + OFFERS_MODAL_PADDING / 2
      : card.x + card.width / 2 + OFFER_BUTTON_GAP / 2;
  return {
    x,
    y: card.y + card.height - OFFER_BUTTON_HEIGHT - 6,
    width: buttonWidth,
    height: OFFER_BUTTON_HEIGHT,
  };
}

// Jobs panel — a modal opened by the `J` key (job-panels.ts) listing every accepted job
// (unplaced + running) with full stats: progress, time left, pay, demands, penalty. Read-only
// (no buttons beyond the shared close/×), so — unlike the offers panel — it has no stable-slot
// requirement: UNPLACED then ACTIVE, sorted by id, same grouping the old docked corner panel
// used, just never truncated (it scrolls instead). See .plans/job-panels.md.
export const JOBS_MODAL_WIDTH = 480;
export const JOBS_MODAL_PADDING = 16;
export const JOBS_MODAL_HEADER_HEIGHT = 34;
export const JOBS_MODAL_CLOSE_BUTTON_SIZE = 32;
// Three lines per job (label+countdown, pay+full demand breakdown+deadline, penalty/recurring)
// — the jobs panel's whole point is showing every stat at once, where the old docked corner
// panel only had room for two lines and a single trait.
export const JOBS_MODAL_ROW_HEIGHT = 58;
export const JOBS_MODAL_HEADER_ROW_HEIGHT = 22;

// Shared by job-panels.ts (scroll clamping) and hud.ts (both the outer rect and the draw loop's
// own vertical walk use these same two constants) so the two can never silently disagree about
// how tall the content actually is.
export function getJobsModalContentHeight(pendingCount: number, activeCount: number): number {
  if (pendingCount === 0 && activeCount === 0) return JOBS_MODAL_ROW_HEIGHT; // "no jobs" message
  let height = 0;
  if (pendingCount > 0)
    height += JOBS_MODAL_HEADER_ROW_HEIGHT + pendingCount * JOBS_MODAL_ROW_HEIGHT;
  if (activeCount > 0) height += JOBS_MODAL_HEADER_ROW_HEIGHT + activeCount * JOBS_MODAL_ROW_HEIGHT;
  return height;
}

export function getJobsModalRect(
  canvasWidth: number,
  canvasHeight: number,
  contentHeight: number,
): Rect {
  const height = JOBS_MODAL_HEADER_HEIGHT + JOBS_MODAL_PADDING * 3 + contentHeight;
  return getCenteredRect(canvasWidth, canvasHeight, JOBS_MODAL_WIDTH, height, JOBS_MODAL_PADDING);
}

export function getJobsModalContentRect(
  canvasWidth: number,
  canvasHeight: number,
  contentHeight: number,
): Rect {
  const modal = getJobsModalRect(canvasWidth, canvasHeight, contentHeight);
  const top = modal.y + JOBS_MODAL_PADDING + JOBS_MODAL_HEADER_HEIGHT + JOBS_MODAL_PADDING;
  return {
    x: modal.x + JOBS_MODAL_PADDING,
    y: top,
    width: modal.width - JOBS_MODAL_PADDING * 2,
    height: modal.y + modal.height - JOBS_MODAL_PADDING - top,
  };
}

export function getJobsModalCloseButtonRect(
  canvasWidth: number,
  canvasHeight: number,
  contentHeight: number,
): Rect {
  const modal = getJobsModalRect(canvasWidth, canvasHeight, contentHeight);
  return {
    x: modal.x + modal.width - JOBS_MODAL_PADDING - JOBS_MODAL_CLOSE_BUTTON_SIZE,
    y:
      modal.y +
      (JOBS_MODAL_HEADER_HEIGHT - JOBS_MODAL_CLOSE_BUTTON_SIZE) / 2 +
      JOBS_MODAL_PADDING / 2,
    width: JOBS_MODAL_CLOSE_BUTTON_SIZE,
    height: JOBS_MODAL_CLOSE_BUTTON_SIZE,
  };
}

// Rack panel — opened by clicking a rack (D3/D4: per-rack, not per-server, so moving a
// workload between servers is a single drag; viewable without travel, drags gated on arrival).
// Centered overlay rather than pinned to a HUD edge: it needs room for up to RACK_SLOT_CAPACITY
// server rows, each with TRAIT_KEYS.length trait bars, plus a tray strip — more content than
// any existing HUD panel. See .plans/workload-dispatch.md step 7.
export const RACK_PANEL_WIDTH = 460;
export const RACK_PANEL_PADDING = 16;
// 34px, up from 30 — just enough extra to fit RACK_CLOSE_BUTTON_SIZE's touch-target bump
// without the button poking past the header/padding region into the content area below.
export const RACK_PANEL_HEADER_HEIGHT = 34;
// Was 54, then 100, then 116 — 116 was sized for three trait rows only. .plans/hardware-failure.md
// Step 6 adds a 4th bar-shaped row (wear, reusing getServerTraitBarRect at traitIndex ===
// TRAIT_KEYS.length — see render.ts) plus a row of repair/decommission buttons beneath it.
// Layout, top to bottom: 16px to the server-name label, 14px to the power/cooling draw line,
// then a gap, then four stacked bar rows (three traits + wear, each a label line + a 6px bar,
// 20px apart), a 6px gap, an 18px action-button row, 8px bottom margin. See
// getServerRowLabelY / getServerRowDrawY / getServerTraitBarRect / getServerActionButtonRect
// below for the exact offsets this height is sized against — keep them in sync if this changes.
export const RACK_SERVER_ROW_HEIGHT = 162;
export const RACK_SERVER_ROW_GAP = 10;
export const RACK_TRAIT_BAR_HEIGHT = 6;
export const RACK_TRAIT_BAR_GAP = 4;
export const RACK_CHIP_HEIGHT = 16;
export const RACK_CHIP_GAP = 3;
// Was 96, wide enough for "Render Farm 🔥0.8" (the longest label+cooling-bonus chip text) at
// 9px sans-serif. Grown by .plans/contract-variety.md step 2 so a recurring cycle counter
// ("Render Farm 2/2 🔥0.8") also fits without truncating. Shared by getServerTraitBarRect
// (as its chip-column reservation) and getPlacedChipRect — keep them equal.
export const RACK_CHIP_WIDTH = 112;
export const RACK_TRAY_HEADER_HEIGHT = 20;
// Was 110x38 (3 lines) — grown by .plans/contract-variety.md step 1/2 to fit a 4th line
// (penalty), plus a cycle counter appended to the label line for recurring contracts.
export const RACK_TRAY_CARD_WIDTH = 130;
export const RACK_TRAY_CARD_HEIGHT = 50;
export const RACK_TRAY_CARD_GAP = 8;
// 32px — touch-target floor (see .plans/mobile-touch-support.md D4), up from 24.
export const RACK_CLOSE_BUTTON_SIZE = 32;

// Tray cards wrap onto additional rows once a single row would overflow the panel's content
// width — a rack can accept more workloads than fit on one line (see the game concept's
// dispatch loop), and a single overflowing line hid everything past the first few cards.
// `panelWidth` is the already-computed outer panel width (see getRackPanelRect), so this has
// no circular dependency on the tray height it helps compute.
function getTrayColumns(panelWidth: number): number {
  const availWidth = panelWidth - RACK_PANEL_PADDING * 2;
  return Math.max(
    1,
    Math.floor((availWidth + RACK_TRAY_CARD_GAP) / (RACK_TRAY_CARD_WIDTH + RACK_TRAY_CARD_GAP)),
  );
}

function getTrayHeight(trayCount: number, panelWidth: number): number {
  if (trayCount === 0) return RACK_TRAY_HEADER_HEIGHT + RACK_TRAY_CARD_HEIGHT;
  const rows = Math.ceil(trayCount / getTrayColumns(panelWidth));
  return RACK_TRAY_HEADER_HEIGHT + rows * RACK_TRAY_CARD_HEIGHT + (rows - 1) * RACK_TRAY_CARD_GAP;
}

export function getRackPanelRect(
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): Rect {
  const serversHeight =
    serverCount > 0
      ? serverCount * RACK_SERVER_ROW_HEIGHT + (serverCount - 1) * RACK_SERVER_ROW_GAP
      : 0;
  const width = Math.min(RACK_PANEL_WIDTH, canvasWidth - RACK_PANEL_PADDING * 2);
  const trayHeight = getTrayHeight(trayCount, width);
  const height = Math.min(
    RACK_PANEL_HEADER_HEIGHT + RACK_PANEL_PADDING * 3 + serversHeight + trayHeight,
    canvasHeight - RACK_PANEL_PADDING * 2,
  );

  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
  };
}

// The full, unclamped height of everything the panel would need to draw (every server row plus
// the tray) — as opposed to getRackPanelRect's height, which is clamped to fit the canvas. The
// difference between this and getRackPanelContentRect's height is how far the panel can scroll;
// see rack-panel.ts's scroll handling.
export function getRackPanelContentHeight(
  canvasWidth: number,
  serverCount: number,
  trayCount: number,
): number {
  const serversHeight =
    serverCount > 0
      ? serverCount * RACK_SERVER_ROW_HEIGHT + (serverCount - 1) * RACK_SERVER_ROW_GAP
      : 0;
  const width = Math.min(RACK_PANEL_WIDTH, canvasWidth - RACK_PANEL_PADDING * 2);
  return serversHeight + RACK_PANEL_PADDING + getTrayHeight(trayCount, width);
}

// The scrollable sub-region inside the panel: everything below the header, inset by the same
// padding as the rest of the panel. render.ts clips to this rect and translates its drawing by
// -scrollOffsetPx; rack-panel.ts's hit-testing subtracts the same offset from the pointer before
// comparing against row/tray/chip rects (which are laid out in unscrolled content space — see
// getServerRowRect et al.). Content taller than this rect is what makes the panel scroll at all.
export function getRackPanelContentRect(
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): Rect {
  const panel = getRackPanelRect(canvasWidth, canvasHeight, serverCount, trayCount);
  const top = panel.y + RACK_PANEL_PADDING + RACK_PANEL_HEADER_HEIGHT + RACK_PANEL_PADDING;
  return {
    x: panel.x + RACK_PANEL_PADDING,
    y: top,
    width: panel.width - RACK_PANEL_PADDING * 2,
    height: panel.y + panel.height - RACK_PANEL_PADDING - top,
  };
}

export function getRackPanelCloseButtonRect(
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): Rect {
  const panel = getRackPanelRect(canvasWidth, canvasHeight, serverCount, trayCount);
  return {
    x: panel.x + panel.width - RACK_PANEL_PADDING - RACK_CLOSE_BUTTON_SIZE,
    y: panel.y + (RACK_PANEL_HEADER_HEIGHT - RACK_CLOSE_BUTTON_SIZE) / 2 + RACK_PANEL_PADDING / 2,
    width: RACK_CLOSE_BUTTON_SIZE,
    height: RACK_CLOSE_BUTTON_SIZE,
  };
}

export function getServerRowRect(
  index: number,
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): Rect {
  const panel = getRackPanelRect(canvasWidth, canvasHeight, serverCount, trayCount);
  const top = panel.y + RACK_PANEL_PADDING + RACK_PANEL_HEADER_HEIGHT + RACK_PANEL_PADDING;
  return {
    x: panel.x + RACK_PANEL_PADDING,
    y: top + index * (RACK_SERVER_ROW_HEIGHT + RACK_SERVER_ROW_GAP),
    width: panel.width - RACK_PANEL_PADDING * 2,
    height: RACK_SERVER_ROW_HEIGHT,
  };
}

// Row-internal vertical rhythm, top to bottom: RACK_ROW_LABEL_OFFSET_Y to the server-name
// label, then RACK_ROW_BARS_TOP_OFFSET_Y before the first trait bar's own label, then one
// RACK_TRAIT_ROW_HEIGHT per trait (label line + gap + bar). Kept as named constants (not
// inlined into each function) so the label and the bars it describes can never silently drift
// apart the way they did before this fix — RACK_SERVER_ROW_HEIGHT's comment is sized against
// exactly these numbers, so change them together.
const RACK_ROW_LABEL_OFFSET_Y = 16;
const RACK_ROW_DRAW_OFFSET_Y = 30;
const RACK_ROW_BARS_TOP_OFFSET_Y = 50;
const RACK_TRAIT_ROW_HEIGHT = 20; // 10px label line + RACK_TRAIT_BAR_GAP + RACK_TRAIT_BAR_HEIGHT

// Baseline Y for the server's own name/status label, top-left of the row.
export function getServerRowLabelY(row: Rect): number {
  return row.y + RACK_ROW_LABEL_OFFSET_Y;
}

// Baseline Y for the server's power/cooling draw line, just beneath the name/status label.
export function getServerRowDrawY(row: Rect): number {
  return row.y + RACK_ROW_DRAW_OFFSET_Y;
}

// One bar per TRAIT_KEYS entry, stacked vertically (not side by side — three short horizontal
// bars in a row read worse than three full-width bars stacked, and stacking leaves room for
// each bar's own label without crowding). See RACK_SERVER_ROW_HEIGHT's comment for the budget
// this geometry is sized against.
export function getServerTraitBarRect(
  serverIndex: number,
  traitIndex: number,
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): Rect {
  const row = getServerRowRect(serverIndex, canvasWidth, canvasHeight, serverCount, trayCount);
  const barsTop = row.y + RACK_ROW_BARS_TOP_OFFSET_Y;
  // Chips sit at the row's top-right (see getPlacedChipRect); trait bars stop short of that
  // column so a long trait label/bar never runs under a chip. Shares RACK_CHIP_WIDTH with
  // getPlacedChipRect so the two never drift apart.
  const chipColumnWidth = RACK_CHIP_WIDTH;
  // Each trait gets a RACK_TRAIT_ROW_HEIGHT-tall block; the bar sits at the block's bottom so
  // its own label (drawn above it by render.ts) has the full block's top to sit in without
  // colliding with the previous trait's bar.
  return {
    x: row.x,
    y:
      barsTop +
      traitIndex * RACK_TRAIT_ROW_HEIGHT +
      (RACK_TRAIT_ROW_HEIGHT - RACK_TRAIT_BAR_HEIGHT),
    width: row.width - chipColumnWidth,
    height: RACK_TRAIT_BAR_HEIGHT,
  };
}

// Repair/decommission buttons — a row beneath the trait+wear bars. See
// .plans/hardware-failure.md Step 6. Repair sits left, decommission right, both bottom-aligned
// in the row (RACK_SERVER_ROW_HEIGHT's comment is sized against this).
export const RACK_ACTION_BUTTON_WIDTH = 90;
export const RACK_ACTION_BUTTON_HEIGHT = 18;
export const RACK_ACTION_BUTTON_GAP = 8;

function getServerActionsRowY(row: Rect): number {
  return row.y + RACK_ROW_BARS_TOP_OFFSET_Y + 4 * RACK_TRAIT_ROW_HEIGHT + 6;
}

export function getServerRepairButtonRect(
  serverIndex: number,
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): Rect {
  const row = getServerRowRect(serverIndex, canvasWidth, canvasHeight, serverCount, trayCount);
  return {
    x: row.x + row.width - RACK_ACTION_BUTTON_WIDTH * 2 - RACK_ACTION_BUTTON_GAP,
    y: getServerActionsRowY(row),
    width: RACK_ACTION_BUTTON_WIDTH,
    height: RACK_ACTION_BUTTON_HEIGHT,
  };
}

export function getServerDecommissionButtonRect(
  serverIndex: number,
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): Rect {
  const row = getServerRowRect(serverIndex, canvasWidth, canvasHeight, serverCount, trayCount);
  return {
    x: row.x + row.width - RACK_ACTION_BUTTON_WIDTH,
    y: getServerActionsRowY(row),
    width: RACK_ACTION_BUTTON_WIDTH,
    height: RACK_ACTION_BUTTON_HEIGHT,
  };
}

// Small chips along the top-right of a server row, one per workload placed on it.
export function getPlacedChipRect(
  serverIndex: number,
  chipIndex: number,
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): Rect {
  const row = getServerRowRect(serverIndex, canvasWidth, canvasHeight, serverCount, trayCount);
  const chipWidth = RACK_CHIP_WIDTH;
  return {
    x: row.x + row.width - chipWidth,
    y: row.y + 2 + chipIndex * (RACK_CHIP_HEIGHT + RACK_CHIP_GAP),
    width: chipWidth,
    height: RACK_CHIP_HEIGHT,
  };
}

// Tray strip along the panel's bottom edge — accepted-but-unplaced workloads (D3).
export function getTrayCardRect(
  index: number,
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): Rect {
  const panel = getRackPanelRect(canvasWidth, canvasHeight, serverCount, trayCount);
  const columns = getTrayColumns(panel.width);
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: panel.x + RACK_PANEL_PADDING + column * (RACK_TRAY_CARD_WIDTH + RACK_TRAY_CARD_GAP),
    y:
      getTrayTopY(canvasWidth, canvasHeight, serverCount, trayCount) +
      RACK_TRAY_HEADER_HEIGHT +
      row * (RACK_TRAY_CARD_HEIGHT + RACK_TRAY_CARD_GAP),
    width: RACK_TRAY_CARD_WIDTH,
    height: RACK_TRAY_CARD_HEIGHT,
  };
}

// "Abandon this contract" button (F3) — a small square overlaid in the tray card's top-right
// corner rather than a 5th text line, which would mean re-growing RACK_TRAY_CARD_HEIGHT again;
// the card's 4 existing lines (label+cycle, demands, deadline, penalty) already fill its height.
export const RACK_TRAY_DROP_BUTTON_SIZE = 16;
export const RACK_TRAY_DROP_BUTTON_MARGIN = 4;

export function getTrayCardDropButtonRect(
  index: number,
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): Rect {
  const card = getTrayCardRect(index, canvasWidth, canvasHeight, serverCount, trayCount);
  return {
    x: card.x + card.width - RACK_TRAY_DROP_BUTTON_SIZE - RACK_TRAY_DROP_BUTTON_MARGIN,
    y: card.y + RACK_TRAY_DROP_BUTTON_MARGIN,
    width: RACK_TRAY_DROP_BUTTON_SIZE,
    height: RACK_TRAY_DROP_BUTTON_SIZE,
  };
}

// Y coordinate of the tray section's header text baseline — shared by getTrayCardRect and by
// render.ts (which draws the "TRAY" header itself, above the cards this function positions).
export function getTrayTopY(
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): number {
  const panel = getRackPanelRect(canvasWidth, canvasHeight, serverCount, trayCount);
  const serversHeight =
    serverCount > 0
      ? serverCount * RACK_SERVER_ROW_HEIGHT + (serverCount - 1) * RACK_SERVER_ROW_GAP
      : 0;
  return (
    panel.y +
    RACK_PANEL_PADDING +
    RACK_PANEL_HEADER_HEIGHT +
    RACK_PANEL_PADDING +
    serversHeight +
    RACK_PANEL_PADDING
  );
}

// The tray strip's full-width hit area (header + cards), used to detect "dropped on the tray"
// during a drag — the complement of getServerRowRect for drag targets.
export function getTrayDropRect(
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): Rect {
  const panel = getRackPanelRect(canvasWidth, canvasHeight, serverCount, trayCount);
  const top = getTrayTopY(canvasWidth, canvasHeight, serverCount, trayCount);
  return {
    x: panel.x + RACK_PANEL_PADDING,
    y: top,
    width: panel.width - RACK_PANEL_PADDING * 2,
    height: panel.y + panel.height - RACK_PANEL_PADDING - top,
  };
}

// Shop panel — opened by proximity to the shop door (shop.ts), closed by walking away. Follows
// the rack panel's centered-modal geometry (getRackPanelRect above): category tabs across the
// top, one row per catalog entry in the selected category, a buy button per row. See
// .plans/facility-shop-inventory.md Step 5.
export const SHOP_PANEL_WIDTH = 420;
export const SHOP_PANEL_PADDING = 16;
// Header/row/button sizes bumped for touch-target floor (see .plans/mobile-touch-support.md
// D4) — row text is positioned by fraction of row.height (render.ts), so it re-centers safely.
export const SHOP_PANEL_HEADER_HEIGHT = 34;
export const SHOP_TAB_HEIGHT = 28;
export const SHOP_ROW_HEIGHT = 44;
export const SHOP_ROW_GAP = 6;
export const SHOP_BUY_BUTTON_WIDTH = 70;
export const SHOP_BUY_BUTTON_HEIGHT = 34;
export const SHOP_CLOSE_BUTTON_SIZE = 32;

export function getShopPanelRect(
  canvasWidth: number,
  canvasHeight: number,
  rowCount: number,
): Rect {
  const rowsHeight =
    rowCount > 0 ? rowCount * SHOP_ROW_HEIGHT + (rowCount - 1) * SHOP_ROW_GAP : SHOP_ROW_HEIGHT;
  const width = Math.min(SHOP_PANEL_WIDTH, canvasWidth - SHOP_PANEL_PADDING * 2);
  const height = Math.min(
    SHOP_PANEL_HEADER_HEIGHT + SHOP_TAB_HEIGHT + SHOP_PANEL_PADDING * 3 + rowsHeight,
    canvasHeight - SHOP_PANEL_PADDING * 2,
  );
  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
  };
}

export function getShopCloseButtonRect(
  canvasWidth: number,
  canvasHeight: number,
  rowCount: number,
): Rect {
  const panel = getShopPanelRect(canvasWidth, canvasHeight, rowCount);
  return {
    x: panel.x + panel.width - SHOP_PANEL_PADDING - SHOP_CLOSE_BUTTON_SIZE,
    y: panel.y + (SHOP_PANEL_HEADER_HEIGHT - SHOP_CLOSE_BUTTON_SIZE) / 2 + SHOP_PANEL_PADDING / 2,
    width: SHOP_CLOSE_BUTTON_SIZE,
    height: SHOP_CLOSE_BUTTON_SIZE,
  };
}

export function getShopTabRect(
  tabIndex: number,
  tabCount: number,
  canvasWidth: number,
  canvasHeight: number,
  rowCount: number,
): Rect {
  const panel = getShopPanelRect(canvasWidth, canvasHeight, rowCount);
  const tabsTop = panel.y + SHOP_PANEL_PADDING + SHOP_PANEL_HEADER_HEIGHT;
  const tabWidth = (panel.width - SHOP_PANEL_PADDING * 2) / tabCount;
  return {
    x: panel.x + SHOP_PANEL_PADDING + tabIndex * tabWidth,
    y: tabsTop,
    width: tabWidth,
    height: SHOP_TAB_HEIGHT,
  };
}

export function getShopRowRect(
  index: number,
  canvasWidth: number,
  canvasHeight: number,
  rowCount: number,
): Rect {
  const panel = getShopPanelRect(canvasWidth, canvasHeight, rowCount);
  const top =
    panel.y + SHOP_PANEL_PADDING + SHOP_PANEL_HEADER_HEIGHT + SHOP_TAB_HEIGHT + SHOP_PANEL_PADDING;
  return {
    x: panel.x + SHOP_PANEL_PADDING,
    y: top + index * (SHOP_ROW_HEIGHT + SHOP_ROW_GAP),
    width: panel.width - SHOP_PANEL_PADDING * 2,
    height: SHOP_ROW_HEIGHT,
  };
}

export function getShopBuyButtonRect(
  index: number,
  canvasWidth: number,
  canvasHeight: number,
  rowCount: number,
): Rect {
  const row = getShopRowRect(index, canvasWidth, canvasHeight, rowCount);
  return {
    x: row.x + row.width - SHOP_BUY_BUTTON_WIDTH,
    y: row.y + (row.height - SHOP_BUY_BUTTON_HEIGHT) / 2,
    width: SHOP_BUY_BUTTON_WIDTH,
    height: SHOP_BUY_BUTTON_HEIGHT,
  };
}

// Toast stack (F4/F7) — centered under the HUD bar so it reads as "something just happened".
// Used to also dodge the offers column (left) and workload panel (right) it sat between, but
// both are now toggled modals rather than permanently-docked chrome (see .plans/job-panels.md),
// so there's nothing left to dodge.
export const TOAST_WIDTH = 340;
export const TOAST_HEIGHT = 30;
export const TOAST_GAP = 6;
export const TOAST_TOP_MARGIN = 8;

export function getToastRect(stackIndex: number, canvasWidth: number): Rect {
  return {
    x: (canvasWidth - TOAST_WIDTH) / 2,
    y: HUD_BAR_HEIGHT + TOAST_TOP_MARGIN + stackIndex * (TOAST_HEIGHT + TOAST_GAP),
    width: TOAST_WIDTH,
    height: TOAST_HEIGHT,
  };
}

// The world-drawing/camera-framing area, minus the top HUD bar. Used to be minus the left
// offers column and right workload panel column too, but those are now toggled modals (see
// .plans/job-panels.md) rather than permanently-docked chrome, so there's no fixed column width
// to reserve any more — the play area now fills the canvas below the bar.
export function getGameViewportRect(canvasWidth: number, canvasHeight: number): Rect {
  const top = HUD_BAR_HEIGHT;
  return { x: 0, y: top, width: canvasWidth, height: Math.max(0, canvasHeight - top) };
}

export function pointerInHud(point: { x: number; y: number }, canvas: HTMLCanvasElement): boolean {
  // canvas.clientWidth (CSS-pixel/logical size), not canvas.width — the latter is the
  // dpr-scaled backing-buffer resolution set by rendering/index.ts (see
  // .plans/mobile-touch-support.md D5) and would misalign every rect below against a
  // CSS-pixel pointer position.
  if (pointerInRect(point, getHudBarRect(canvas.clientWidth))) return true;

  // The offers/jobs panels are centered modals, like the rack/shop panels — those absorb clicks
  // via their own "modal is open" check in input.ts's priority chain, not by being permanently
  // blocked here (see .plans/job-panels.md).

  // The tutorial banner is deliberately NOT blocked here (see .plans/playtest-findings.md B1):
  // it's an overlay, not an interactive panel, and its own two hit targets (action button, skip
  // link) are already checked ahead of everything else in input.ts's click chain. Blocking the
  // world underneath it used to make anything the banner happened to sit over — including, once,
  // the shop door — unreachable by click for as long as the banner was up.
  return false;
}

// Tutorial banner — a persistent, always-on-top overlay (drawn last, by hud.ts) explaining the
// current guided-tutorial step. Anchored to the BOTTOM of the canvas, above the build panel
// (see getBuildPanelHeight) — not centered under the HUD bar, where it used to sit directly on
// top of the shop door (the camera clamps the world's top edge to a fixed screen position, so
// anything docked under the HUD bar covers the same world location for the whole tutorial; see
// .plans/playtest-findings.md B1). Its own action/skip buttons are hit-tested in input.ts,
// ahead of everything else in the priority chain, same treatment as the mute button.
export const TUTORIAL_BANNER_WIDTH = 460;
// Generous height for up to 3 wrapped body lines plus the title and (on welcome/done) a
// primary button — see hud.ts's drawTutorialBanner, the only place that measures actual text
// width to wrap it.
export const TUTORIAL_BANNER_HEIGHT = 118;
export const TUTORIAL_BANNER_MARGIN_BOTTOM = 8;
export const TUTORIAL_ACTION_BUTTON_WIDTH = 130;
export const TUTORIAL_ACTION_BUTTON_HEIGHT = 26;
export const TUTORIAL_SKIP_WIDTH = 92;
export const TUTORIAL_SKIP_HEIGHT = 18;

export function getTutorialBannerRect(canvasWidth: number, canvasHeight: number): Rect {
  // Width and horizontal position both fit within the game viewport's gap between the offers
  // column (left) and the workload panel column (right) — see getGameViewportRect — rather
  // than centering against the raw canvas, which could still overlap a tall offers column on
  // a short/narrow canvas even after the vertical (build-panel) fix below. See
  // .plans/playtest-findings.md B5.
  const viewport = getGameViewportRect(canvasWidth, canvasHeight);
  const width = Math.min(TUTORIAL_BANNER_WIDTH, Math.max(0, viewport.width - HUD_PANEL_MARGIN * 2));
  // Reserve the build panel's full column (not just its current width) so the banner never
  // overlaps it regardless of canvas width — same "reserve the column" reasoning as above.
  const bottomReserved = BUILD_PANEL_MARGIN + getBuildPanelHeight() + TUTORIAL_BANNER_MARGIN_BOTTOM;
  return {
    x: viewport.x + (viewport.width - width) / 2,
    y: canvasHeight - bottomReserved - TUTORIAL_BANNER_HEIGHT,
    width,
    height: TUTORIAL_BANNER_HEIGHT,
  };
}

export function getTutorialActionButtonRect(canvasWidth: number, canvasHeight: number): Rect {
  const banner = getTutorialBannerRect(canvasWidth, canvasHeight);
  return {
    x: banner.x + banner.width - TUTORIAL_ACTION_BUTTON_WIDTH - 12,
    y: banner.y + banner.height - TUTORIAL_ACTION_BUTTON_HEIGHT - 10,
    width: TUTORIAL_ACTION_BUTTON_WIDTH,
    height: TUTORIAL_ACTION_BUTTON_HEIGHT,
  };
}

export function getTutorialSkipRect(canvasWidth: number, canvasHeight: number): Rect {
  const banner = getTutorialBannerRect(canvasWidth, canvasHeight);
  return {
    x: banner.x + banner.width - TUTORIAL_SKIP_WIDTH - 10,
    y: banner.y + 8,
    width: TUTORIAL_SKIP_WIDTH,
    height: TUTORIAL_SKIP_HEIGHT,
  };
}
