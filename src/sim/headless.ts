// Headless stand-ins for the four browser-backed dependencies every system factory takes.
// They satisfy the interfaces without a canvas, an AudioContext or a DOM event source, so the
// full simulation pipeline (ecs/pipeline.ts) runs in Node exactly as it does in the browser.
//
// Each is deliberately inert rather than a recording spy: the harness asserts on world state,
// never on "was this drawn" or "was this played".
import { type Renderer } from '../rendering';
import { type Camera, type Point } from '../camera';
import { type Audio } from '../audio';
import { type InputStateTracker, type InputStateSnapshot } from '../input-state';

export const DEFAULT_CANVAS_WIDTH = 1280;
export const DEFAULT_CANVAS_HEIGHT = 720;

/**
 * `canvas`/`context` are left unset: no simulation system touches either (only the render/HUD
 * systems do, and those never run headlessly), so a null here surfaces as a loud failure if
 * that ever stops being true, rather than a silently wrong drawing.
 */
export function headlessRenderer(
  width: number = DEFAULT_CANVAS_WIDTH,
  height: number = DEFAULT_CANVAS_HEIGHT,
): Renderer {
  return {
    canvas: null as unknown as HTMLCanvasElement,
    context: null as unknown as CanvasRenderingContext2D,
    width,
    height,
    clear() {},
    dispose() {},
  };
}

// Screen space and world space coincide, so a pointer position given to a click handler is
// already the world point it names — which is what lets a scripted player address grid cells
// directly via gridToWorld.
export function headlessCamera(): Camera {
  return {
    x: 0,
    y: 0,
    scale: 1,
    detached: false,
    pan() {},
    recenter() {},
    worldToScreen: (p: Point) => ({ x: p.x, y: p.y }),
    screenToWorld: (p: Point) => ({ x: p.x, y: p.y }),
    applyTransform() {},
    resetTransform() {},
    update() {},
  };
}

const NO_INPUT: InputStateSnapshot = {
  keysDown: new Set(),
  keysPressedSincePreviousFrame: new Set(),
  mousePosition: null,
  mouseButtonsDown: new Set(),
  mouseDeltaX: 0,
  mouseDeltaY: 0,
  mouseButtonsHeldSincePreviousFrame: new Set(),
  mouseButtonsPressedSincePreviousFrame: new Set(),
  wasClicked: false,
  wasRightClicked: false,
};

// A tracker that never reports input. input.ts, job-panels.ts and rack-panel.ts all early-out
// on an empty snapshot, so they stay in the pipeline (and keep being exercised) while the
// scripted player drives the game through the domain entry points those systems call into.
export function headlessInput(): InputStateTracker {
  return {
    getState: () => NO_INPUT,
    update() {},
    consumeWheelDeltaY: () => 0,
    consumeZoomDelta: () => 0,
    dispose() {},
  };
}

export function headlessAudio(): Audio {
  return {
    play() {},
    setMuted() {},
    isMuted: () => false,
    startMusic() {},
    stopMusic() {},
  };
}
