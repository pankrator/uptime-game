export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  // Logical (CSS-pixel) canvas size — what every layout/hit-test function in ui/layout.ts
  // expects, and NOT the same as canvas.width/height once devicePixelRatio scaling is applied
  // below. Always mirrors canvas.clientWidth/Height.
  readonly width: number;
  readonly height: number;
  clear(): void;
  // Removes the window listeners registered below. Harmless while runGame runs once per page
  // load (nothing calls this today); exists so a future "quit to menu" feature —
  // createGameLoop already has the matching stop() — has a matching one here to pair with a
  // fresh createRenderer() on restart, instead of a second 'resize' listener stacking on top
  // of the first.
  dispose(): void;
}

// Caps how far the backing buffer scales up on very high-DPR devices — a 2D canvas this
// drawing-call-heavy (HUD text, panels, the floor) redraws every frame, and pixel count grows
// with the square of the cap, so an uncapped devicePixelRatio (3 or more on some phones) would
// cost real frame time for sharpness beyond what's visibly distinguishable.
const MAX_DEVICE_PIXEL_RATIO = 2;

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to acquire 2D rendering context');
  }

  // Backing-buffer resolution matches devicePixelRatio (capped) so text/lines stay sharp on
  // high-DPI screens — every current phone/tablet — instead of being upscaled blurry by the
  // browser. setTransform (not scale) so a resize later in the session never compounds the dpr
  // factor onto itself. Every drawing call elsewhere keeps working in CSS-pixel coordinates —
  // this is the one place that changes.
  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    context!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  // Some mobile browsers don't fire a timely 'resize' on rotation.
  window.addEventListener('orientationchange', resize);
  resize();

  return {
    canvas,
    context,
    get width() {
      return canvas.clientWidth;
    },
    get height() {
      return canvas.clientHeight;
    },
    clear() {
      context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    },
    dispose() {
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
    },
  };
}
