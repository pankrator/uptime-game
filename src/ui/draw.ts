// Shared canvas drawing vocabulary, used by render.ts and hud.ts.
//
// Deliberately small: no framework, no retained-mode scene graph — a canvas UI library would be
// solving a problem this project does not have at this scale.
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
