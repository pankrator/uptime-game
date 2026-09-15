import { BUILDABLES } from '../ecs/components';

export const BUILD_PANEL_MARGIN = 12;
export const BUILD_PANEL_ENTRY_WIDTH = 120;
export const BUILD_PANEL_ENTRY_HEIGHT = 32;
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

export function getBuildPanelEntryRect(index: number, canvasHeight: number): Rect {
  const totalHeight =
    BUILDABLES.length * BUILD_PANEL_ENTRY_HEIGHT + (BUILDABLES.length - 1) * BUILD_PANEL_ENTRY_GAP;
  const startY = canvasHeight - BUILD_PANEL_MARGIN - totalHeight;
  return {
    x: BUILD_PANEL_MARGIN,
    y: startY + index * (BUILD_PANEL_ENTRY_HEIGHT + BUILD_PANEL_ENTRY_GAP),
    width: BUILD_PANEL_ENTRY_WIDTH,
    height: BUILD_PANEL_ENTRY_HEIGHT,
  };
}

export const HUD_BAR_HEIGHT = 36;
export const HUD_PANEL_WIDTH = 240;
export const HUD_PANEL_MARGIN = 12;
export const HUD_ROW_HEIGHT = 28;
export const HUD_PANEL_MAX_ROWS = 6;

export function getHudBarRect(canvasWidth: number): Rect {
  return { x: 0, y: 0, width: canvasWidth, height: HUD_BAR_HEIGHT };
}

function getHudPanelWidth(canvasWidth: number): number {
  return Math.min(HUD_PANEL_WIDTH, canvasWidth - HUD_PANEL_MARGIN * 2);
}

// `rowCount` is the total number of content rows (section headers included, pending rows
// counted twice for their shortfall line) — the same unit `getWorkloadRowRect`'s `index` walks.
export function getWorkloadPanelRect(canvasWidth: number, rowCount: number): Rect {
  const width = getHudPanelWidth(canvasWidth);
  const height = Math.max(rowCount, 1) * HUD_ROW_HEIGHT + HUD_PANEL_MARGIN * 2;
  return {
    x: canvasWidth - HUD_PANEL_MARGIN - width,
    y: HUD_BAR_HEIGHT + HUD_PANEL_MARGIN,
    width,
    height,
  };
}

export function getWorkloadRowRect(index: number, canvasWidth: number, rowCount: number): Rect {
  const panel = getWorkloadPanelRect(canvasWidth, rowCount);
  return {
    x: panel.x,
    y: panel.y + HUD_PANEL_MARGIN + index * HUD_ROW_HEIGHT,
    width: panel.width,
    height: HUD_ROW_HEIGHT,
  };
}

// Offers panel — up to MAX_OFFERS cards, stacked below the top HUD bar on the LEFT (the
// workload panel above occupies the right), each with its own Accept/Decline hit rects. See
// .plans/workload-dispatch.md step 5.
export const OFFER_CARD_WIDTH = 220;
export const OFFER_CARD_HEIGHT = 76;
export const OFFER_CARD_GAP = 8;
export const OFFER_BUTTON_HEIGHT = 22;
export const OFFER_BUTTON_GAP = 6;

// Left-anchored, fixed width — unlike the workload panel (right-anchored, sized to canvas
// width), so neither function needs a canvasWidth parameter.
export function getOfferCardRect(index: number): Rect {
  return {
    x: HUD_PANEL_MARGIN,
    y: HUD_BAR_HEIGHT + HUD_PANEL_MARGIN + index * (OFFER_CARD_HEIGHT + OFFER_CARD_GAP),
    width: OFFER_CARD_WIDTH,
    height: OFFER_CARD_HEIGHT,
  };
}

export function getOfferButtonRect(index: number, kind: 'accept' | 'decline'): Rect {
  const card = getOfferCardRect(index);
  const buttonWidth = (card.width - HUD_PANEL_MARGIN - OFFER_BUTTON_GAP) / 2;
  const x = kind === 'accept' ? card.x + HUD_PANEL_MARGIN / 2 : card.x + card.width / 2 + OFFER_BUTTON_GAP / 2;
  return {
    x,
    y: card.y + card.height - OFFER_BUTTON_HEIGHT - 6,
    width: buttonWidth,
    height: OFFER_BUTTON_HEIGHT,
  };
}

function getOffersPanelRect(offerCount: number): Rect {
  const count = Math.max(offerCount, 0);
  const height = count === 0 ? 0 : count * OFFER_CARD_HEIGHT + (count - 1) * OFFER_CARD_GAP;
  return {
    x: HUD_PANEL_MARGIN,
    y: HUD_BAR_HEIGHT + HUD_PANEL_MARGIN,
    width: OFFER_CARD_WIDTH,
    height,
  };
}

// Rack panel — opened by clicking a rack (D3/D4: per-rack, not per-server, so moving a
// workload between servers is a single drag; viewable without travel, drags gated on arrival).
// Centered overlay rather than pinned to a HUD edge: it needs room for up to RACK_SLOT_CAPACITY
// server rows, each with TRAIT_KEYS.length trait bars, plus a tray strip — more content than
// any existing HUD panel. See .plans/workload-dispatch.md step 7.
export const RACK_PANEL_WIDTH = 460;
export const RACK_PANEL_PADDING = 16;
export const RACK_PANEL_HEADER_HEIGHT = 30;
// Was 54, then 100 — 100 was too tight once a power/cooling draw line was added below the
// server-name label. Layout, top to bottom: 16px to the server-name label, 14px to the
// power/cooling draw line, then a gap, then three stacked trait rows (each a label line + a
// 6px bar, 20px apart), 8px bottom margin. See getServerRowLabelY / getServerRowDrawY /
// getServerTraitBarRect below for the exact offsets this height is sized against — keep them
// in sync if this changes.
export const RACK_SERVER_ROW_HEIGHT = 116;
export const RACK_SERVER_ROW_GAP = 10;
export const RACK_TRAIT_BAR_HEIGHT = 6;
export const RACK_TRAIT_BAR_GAP = 4;
export const RACK_CHIP_HEIGHT = 16;
export const RACK_CHIP_GAP = 3;
export const RACK_TRAY_HEADER_HEIGHT = 20;
export const RACK_TRAY_CARD_WIDTH = 110;
export const RACK_TRAY_CARD_HEIGHT = 38;
export const RACK_TRAY_CARD_GAP = 8;
export const RACK_CLOSE_BUTTON_SIZE = 24;

export function getRackPanelRect(
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): Rect {
  const serversHeight =
    serverCount > 0 ? serverCount * RACK_SERVER_ROW_HEIGHT + (serverCount - 1) * RACK_SERVER_ROW_GAP : 0;
  const trayHeight =
    RACK_TRAY_HEADER_HEIGHT +
    (trayCount > 0 ? trayCount * RACK_TRAY_CARD_HEIGHT + (trayCount - 1) * RACK_TRAY_CARD_GAP : RACK_TRAY_CARD_HEIGHT);

  const width = Math.min(RACK_PANEL_WIDTH, canvasWidth - RACK_PANEL_PADDING * 2);
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
export function getRackPanelContentHeight(serverCount: number, trayCount: number): number {
  const serversHeight =
    serverCount > 0 ? serverCount * RACK_SERVER_ROW_HEIGHT + (serverCount - 1) * RACK_SERVER_ROW_GAP : 0;
  const trayHeight =
    RACK_TRAY_HEADER_HEIGHT +
    (trayCount > 0 ? trayCount * RACK_TRAY_CARD_HEIGHT + (trayCount - 1) * RACK_TRAY_CARD_GAP : RACK_TRAY_CARD_HEIGHT);
  return serversHeight + RACK_PANEL_PADDING + trayHeight;
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
  // column so a long trait label/bar never runs under a chip. Kept equal to getPlacedChipRect's
  // chipWidth so the two never drift apart.
  const chipColumnWidth = 96;
  // Each trait gets a RACK_TRAIT_ROW_HEIGHT-tall block; the bar sits at the block's bottom so
  // its own label (drawn above it by render.ts) has the full block's top to sit in without
  // colliding with the previous trait's bar.
  return {
    x: row.x,
    y: barsTop + traitIndex * RACK_TRAIT_ROW_HEIGHT + (RACK_TRAIT_ROW_HEIGHT - RACK_TRAIT_BAR_HEIGHT),
    width: row.width - chipColumnWidth,
    height: RACK_TRAIT_BAR_HEIGHT,
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
  // Wide enough for "Render Farm 🔥0.8" (the longest label+cooling-bonus chip text) at 9px
  // sans-serif without truncating — see render.ts's chip label, which appends coolingBonusKw
  // when nonzero.
  const chipWidth = 96;
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
  return {
    x: panel.x + RACK_PANEL_PADDING + index * (RACK_TRAY_CARD_WIDTH + RACK_TRAY_CARD_GAP),
    y: getTrayTopY(canvasWidth, canvasHeight, serverCount, trayCount) + RACK_TRAY_HEADER_HEIGHT,
    width: RACK_TRAY_CARD_WIDTH,
    height: RACK_TRAY_CARD_HEIGHT,
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
    serverCount > 0 ? serverCount * RACK_SERVER_ROW_HEIGHT + (serverCount - 1) * RACK_SERVER_ROW_GAP : 0;
  return (
    panel.y + RACK_PANEL_PADDING + RACK_PANEL_HEADER_HEIGHT + RACK_PANEL_PADDING + serversHeight + RACK_PANEL_PADDING
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
export const SHOP_PANEL_HEADER_HEIGHT = 30;
export const SHOP_TAB_HEIGHT = 28;
export const SHOP_ROW_HEIGHT = 40;
export const SHOP_ROW_GAP = 6;
export const SHOP_BUY_BUTTON_WIDTH = 70;
export const SHOP_BUY_BUTTON_HEIGHT = 26;
export const SHOP_CLOSE_BUTTON_SIZE = 24;

export function getShopPanelRect(canvasWidth: number, canvasHeight: number, rowCount: number): Rect {
  const rowsHeight = rowCount > 0 ? rowCount * SHOP_ROW_HEIGHT + (rowCount - 1) * SHOP_ROW_GAP : SHOP_ROW_HEIGHT;
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

export function getShopCloseButtonRect(canvasWidth: number, canvasHeight: number, rowCount: number): Rect {
  const panel = getShopPanelRect(canvasWidth, canvasHeight, rowCount);
  return {
    x: panel.x + panel.width - SHOP_PANEL_PADDING - SHOP_CLOSE_BUTTON_SIZE,
    y: panel.y + (SHOP_PANEL_HEADER_HEIGHT - SHOP_CLOSE_BUTTON_SIZE) / 2 + SHOP_PANEL_PADDING / 2,
    width: SHOP_CLOSE_BUTTON_SIZE,
    height: SHOP_CLOSE_BUTTON_SIZE,
  };
}

export function getShopTabRect(tabIndex: number, tabCount: number, canvasWidth: number, canvasHeight: number, rowCount: number): Rect {
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

export function getShopRowRect(index: number, canvasWidth: number, canvasHeight: number, rowCount: number): Rect {
  const panel = getShopPanelRect(canvasWidth, canvasHeight, rowCount);
  const top = panel.y + SHOP_PANEL_PADDING + SHOP_PANEL_HEADER_HEIGHT + SHOP_TAB_HEIGHT + SHOP_PANEL_PADDING;
  return {
    x: panel.x + SHOP_PANEL_PADDING,
    y: top + index * (SHOP_ROW_HEIGHT + SHOP_ROW_GAP),
    width: panel.width - SHOP_PANEL_PADDING * 2,
    height: SHOP_ROW_HEIGHT,
  };
}

export function getShopBuyButtonRect(index: number, canvasWidth: number, canvasHeight: number, rowCount: number): Rect {
  const row = getShopRowRect(index, canvasWidth, canvasHeight, rowCount);
  return {
    x: row.x + row.width - SHOP_BUY_BUTTON_WIDTH,
    y: row.y + (row.height - SHOP_BUY_BUTTON_HEIGHT) / 2,
    width: SHOP_BUY_BUTTON_WIDTH,
    height: SHOP_BUY_BUTTON_HEIGHT,
  };
}

// The world-drawing/camera-framing area, minus the strips permanently occupied by HUD
// chrome: the top bar, the left offers column, and the right workload panel column. Both side
// panels grow/shrink in height with their content but always start flush against the canvas
// edge at a fixed width, so reserving their full column (not just their current content
// height) keeps the boundary stable as offers/workloads come and go — recomputing it every
// frame from content height would make the camera framing jitter.
export function getGameViewportRect(canvasWidth: number, canvasHeight: number): Rect {
  const left = HUD_PANEL_MARGIN * 2 + OFFER_CARD_WIDTH;
  const right = HUD_PANEL_MARGIN * 2 + getHudPanelWidth(canvasWidth);
  const top = HUD_BAR_HEIGHT;
  const width = Math.max(0, canvasWidth - left - right);
  const height = Math.max(0, canvasHeight - top);
  return { x: left, y: top, width, height };
}

export function pointerInHud(
  point: { x: number; y: number },
  canvas: HTMLCanvasElement,
  offerCount = 0,
): boolean {
  if (pointerInRect(point, getHudBarRect(canvas.width))) return true;

  // Row count only affects panel height, not x/width — a generous upper bound (max rows,
  // each potentially a 2-line pending row, plus a "+N more" line) safely covers the panel's
  // full extent for hit-testing without needing to know the actual workload list.
  const panelRect = getWorkloadPanelRect(canvas.width, HUD_PANEL_MAX_ROWS * 2 + 1);
  if (pointerInRect(point, panelRect)) return true;

  if (offerCount > 0 && pointerInRect(point, getOffersPanelRect(offerCount))) {
    return true;
  }

  return false;
}

