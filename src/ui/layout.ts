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
