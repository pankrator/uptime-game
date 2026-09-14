import { BUILDABLES } from '../ecs/components';
import { TRAIT_KEYS } from '../ecs/game-data';

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
export const RACK_PANEL_WIDTH = 420;
export const RACK_PANEL_PADDING = 14;
export const RACK_PANEL_HEADER_HEIGHT = 28;
export const RACK_SERVER_ROW_HEIGHT = 54;
export const RACK_SERVER_ROW_GAP = 8;
export const RACK_TRAIT_BAR_HEIGHT = 6;
export const RACK_TRAIT_BAR_GAP = 4;
export const RACK_CHIP_HEIGHT = 16;
export const RACK_CHIP_GAP = 3;
export const RACK_TRAY_HEADER_HEIGHT = 18;
export const RACK_TRAY_CARD_HEIGHT = 34;
export const RACK_TRAY_CARD_GAP = 6;
export const RACK_CLOSE_BUTTON_SIZE = 20;

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

// One bar per TRAIT_KEYS entry, stacked in the lower half of the server row.
export function getServerTraitBarRect(
  serverIndex: number,
  traitIndex: number,
  canvasWidth: number,
  canvasHeight: number,
  serverCount: number,
  trayCount: number,
): Rect {
  const row = getServerRowRect(serverIndex, canvasWidth, canvasHeight, serverCount, trayCount);
  const barsTop = row.y + 20;
  const barWidth = (row.width - 8 * (TRAIT_KEYS.length - 1)) / TRAIT_KEYS.length;
  return {
    x: row.x + traitIndex * (barWidth + 8),
    y: barsTop,
    width: barWidth,
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
  const chipWidth = 70;
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
    x: panel.x + RACK_PANEL_PADDING + index * (RACK_TRAY_CARD_HEIGHT * 2.4 + RACK_TRAY_CARD_GAP),
    y: getTrayTopY(canvasWidth, canvasHeight, serverCount, trayCount) + RACK_TRAY_HEADER_HEIGHT,
    width: RACK_TRAY_CARD_HEIGHT * 2.4,
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

// A click anywhere inside the open rack panel must never fall through to "walk here" — same
// reasoning as pointerInHud for the build/offers/workload panels.
export function pointerInRackPanel(
  point: { x: number; y: number },
  canvas: HTMLCanvasElement,
  serverCount: number,
  trayCount: number,
): boolean {
  const panel = getRackPanelRect(canvas.width, canvas.height, serverCount, trayCount);
  return pointerInRect(point, panel);
}
