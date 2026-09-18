// Shared canvas drawing vocabulary (F11, .plans/design-review.md). Colors that used to be
// declared three separate times (RACK_PANEL_*, SHOP_*, hud.ts's TEXT_COLOR/DIM_COLOR/RED/
// AMBER/GREEN) live here once, and the "grey track, colored fill, clamp the fraction" bar
// pattern — written by hand four times across render.ts and hud.ts — is one function.
//
// Deliberately small: no framework, no retained-mode scene graph. See the finding's own
// trade-off note — a canvas UI library would be solving a problem this project does not have.
export const UI = {
  text: '#e6e8eb',
  dim: '#9aa0a6',
  ok: '#3ddc84',
  warn: '#f7b731',
  bad: '#e5484d',
} as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Grey track, colored fill, fraction clamped to [0, 1] on both ends.
export function bar(ctx: CanvasRenderingContext2D, rect: Rect, fraction: number, color: string): void {
  const clamped = Math.min(1, Math.max(0, fraction));
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.width * clamped, rect.height);
}
