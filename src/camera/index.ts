import { WORLD_WIDTH, WORLD_HEIGHT, CAMERA_PAN_SPEED, CAMERA_FOLLOW_EASE } from '../ecs/game-data';
import { type InputState } from '../input';
import { getGameViewportRect } from '../ui/layout';

export interface Point {
  x: number;
  y: number;
}

export interface Camera {
  x: number;
  y: number;
  worldToScreen(p: Point): Point;
  screenToWorld(p: Point): Point;
  applyTransform(ctx: CanvasRenderingContext2D): void;
  resetTransform(ctx: CanvasRenderingContext2D): void;
  update(deltaSeconds: number, target: Point, canvas: HTMLCanvasElement, input: InputState): void;
}

const PAN_KEYS: Record<string, Point> = {
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
};

function clampAxis(value: number, viewportSize: number, worldSize: number): number {
  if (worldSize <= viewportSize) {
    return (worldSize - viewportSize) / 2;
  }
  return Math.min(Math.max(value, 0), worldSize - viewportSize);
}

export function createCamera(input: InputState): Camera {
  let x = 0;
  let y = 0;
  // WASD panning suspends follow until the player presses space to re-center — otherwise the
  // two would fight every frame.
  let detached = false;

  input.onKeyDown(' ', () => {
    detached = false;
  });

  const camera: Camera = {
    get x() {
      return x;
    },
    set x(value: number) {
      x = value;
    },
    get y() {
      return y;
    },
    set y(value: number) {
      y = value;
    },
    worldToScreen(p: Point): Point {
      return { x: p.x - x, y: p.y - y };
    },
    screenToWorld(p: Point): Point {
      return { x: p.x + x, y: p.y + y };
    },
    applyTransform(ctx: CanvasRenderingContext2D): void {
      ctx.save();
      ctx.translate(-x, -y);
    },
    resetTransform(ctx: CanvasRenderingContext2D): void {
      ctx.restore();
    },
    update(deltaSeconds: number, target: Point, canvas: HTMLCanvasElement, inputState: InputState): void {
      let panDx = 0;
      let panDy = 0;

      for (const [key, dir] of Object.entries(PAN_KEYS)) {
        if (inputState.isKeyDown(key)) {
          panDx += dir.x;
          panDy += dir.y;
        }
      }

      if (panDx !== 0 || panDy !== 0) {
        detached = true;
        const length = Math.hypot(panDx, panDy) || 1;
        x += (panDx / length) * CAMERA_PAN_SPEED * deltaSeconds;
        y += (panDy / length) * CAMERA_PAN_SPEED * deltaSeconds;
      } else if (!detached) {
        // Center the target within the HUD-safe viewport, not the raw canvas — otherwise the
        // top bar and side panels permanently cover whatever world content falls under them
        // (see .plans/facility-shop-inventory.md).
        const viewport = getGameViewportRect(canvas.width, canvas.height);
        const desiredX = target.x - viewport.x - viewport.width / 2;
        const desiredY = target.y - viewport.y - viewport.height / 2;
        const ease = 1 - Math.exp(-CAMERA_FOLLOW_EASE * deltaSeconds);
        x += (desiredX - x) * ease;
        y += (desiredY - y) * ease;
      }

      // Clamp so the SAFE VIEWPORT's world-space extent (not the raw canvas's) stays within
      // world bounds — x/y are the world coordinate at screen (0,0), so the viewport's visible
      // slice is offset by viewport.x/y from that.
      const viewport = getGameViewportRect(canvas.width, canvas.height);
      x = clampAxis(x + viewport.x, viewport.width, WORLD_WIDTH) - viewport.x;
      y = clampAxis(y + viewport.y, viewport.height, WORLD_HEIGHT) - viewport.y;
    },
  };

  return camera;
}
