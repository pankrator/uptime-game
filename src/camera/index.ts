import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  CAMERA_PAN_SPEED,
  CAMERA_FOLLOW_EASE,
  CAMERA_ZOOM_MIN,
  CAMERA_ZOOM_MAX,
} from '../ecs/game-data';
import { type InputStateTracker } from '../input-state';
import { getGameViewportRect } from '../ui/layout';

export interface Point {
  x: number;
  y: number;
}

export interface Camera {
  x: number;
  y: number;
  scale: number;
  // Whether the camera is currently manually panned away from following the controlled entity
  // (WASD, or a drag on the floor). Read-only from the outside; only `pan`/`recenter`/WASD
  // panning inside `update` change it.
  readonly detached: boolean;
  // Manual pan in world units — sets `detached`, same as WASD panning. Used by
  // ecs/systems/camera.ts for drag-to-pan (the touch equivalent of WASD, since a touchscreen has
  // no keyboard).
  pan(dxWorld: number, dyWorld: number): void;
  // Resumes following the controlled entity — the touch/UI equivalent of pressing Space.
  recenter(): void;
  worldToScreen(p: Point): Point;
  screenToWorld(p: Point): Point;
  applyTransform(ctx: CanvasRenderingContext2D): void;
  resetTransform(ctx: CanvasRenderingContext2D): void;
  update(deltaSeconds: number, target: Point, canvas: HTMLCanvasElement, inputState: InputStateTracker): void;
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

export function createCamera(): Camera {
  let x = 0;
  let y = 0;
  let scale = 1;
  // WASD panning (and, on touch, dragging the floor — see ecs/systems/camera.ts) suspends
  // follow until the player recenters — otherwise pan/drag and follow would fight every frame.
  let detached = false;

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
    get scale() {
      return scale;
    },
    set scale(value: number) {
      scale = value;
    },
    get detached() {
      return detached;
    },
    pan(dxWorld: number, dyWorld: number): void {
      detached = true;
      x += dxWorld;
      y += dyWorld;
    },
    recenter(): void {
      detached = false;
    },
    // (world - camera) * scale — the inverse of screenToWorld below, and the same math
    // applyTransform sets up on the canvas context (scale, then translate by -camera).
    worldToScreen(p: Point): Point {
      return { x: (p.x - x) * scale, y: (p.y - y) * scale };
    },
    screenToWorld(p: Point): Point {
      return { x: p.x / scale + x, y: p.y / scale + y };
    },
    applyTransform(ctx: CanvasRenderingContext2D): void {
      ctx.save();
      ctx.scale(scale, scale);
      ctx.translate(-x, -y);
    },
    resetTransform(ctx: CanvasRenderingContext2D): void {
      ctx.restore();
    },
    update(deltaSeconds: number, target: Point, canvas: HTMLCanvasElement, inputState: InputStateTracker): void {
      // consumeZoomDelta, not a snapshot field: this runs from the render loop, at a different
      // rate than the simulation tick that advances inputState's snapshot (input.ts) — see
      // input-state/index.ts's file header for why zoom needs real drain-on-read semantics
      // instead.
      const zoomDelta = inputState.consumeZoomDelta();
      if (zoomDelta !== 0) {
        scale = Math.min(Math.max(scale + zoomDelta, CAMERA_ZOOM_MIN), CAMERA_ZOOM_MAX);
      }

      const state = inputState.getState();

      // Space recenters — idempotent, so reading this edge more than once before input.ts's next
      // update() (this runs at render rate, faster than the simulation tick) is harmless.
      if (state.keysPressedSincePreviousFrame.has(' ')) {
        detached = false;
      }

      let panDx = 0;
      let panDy = 0;

      for (const [key, dir] of Object.entries(PAN_KEYS)) {
        if (state.keysDown.has(key)) {
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
        // Center the target within the HUD-safe viewport, not the raw canvas — otherwise the top
        // bar and side panels permanently cover whatever world content falls under them. The
        // viewport rect is screen-space (HUD chrome doesn't scale with zoom), so its anchor is
        // divided by `scale` to land back in world units before comparing against `target`,
        // which is already world-space.
        const viewport = getGameViewportRect(canvas.clientWidth, canvas.clientHeight);
        const desiredX = target.x - (viewport.x + viewport.width / 2) / scale;
        const desiredY = target.y - (viewport.y + viewport.height / 2) / scale;
        const ease = 1 - Math.exp(-CAMERA_FOLLOW_EASE * deltaSeconds);
        x += (desiredX - x) * ease;
        y += (desiredY - y) * ease;
      }

      // Clamp so the SAFE VIEWPORT's world-space extent (not the raw canvas's) stays within
      // world bounds — x/y are the world coordinate at screen (0,0), so the viewport's visible
      // slice is offset by viewport.x/y from that. Both the offset and the extent are screen-space
      // (raw canvas pixels) and must be divided by `scale` to become world-space before clamping,
      // same reasoning as the follow-target calc above.
      const viewport = getGameViewportRect(canvas.clientWidth, canvas.clientHeight);
      const viewportWorldX = viewport.x / scale;
      const viewportWorldY = viewport.y / scale;
      const viewportWorldWidth = viewport.width / scale;
      const viewportWorldHeight = viewport.height / scale;
      x = clampAxis(x + viewportWorldX, viewportWorldWidth, WORLD_WIDTH) - viewportWorldX;
      y = clampAxis(y + viewportWorldY, viewportWorldHeight, WORLD_HEIGHT) - viewportWorldY;
    },
  };

  return camera;
}
