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
