import { type Renderer } from '../rendering';
import { type GameState } from '../state';
import { type System } from '../ecs/systems/system';
import { type FpsCounter } from '../fps';

export interface GameLoopDeps {
  renderer: Renderer;
  state: GameState;
  updateSystems: System[];
  renderSystems: System[];
  fps: FpsCounter;
}

export interface GameLoop {
  start(): void;
  stop(): void;
}

// Fixed simulation rate. Exported so anything that advances the world by hand (src/sim/) uses
// the same tick length the live loop does, rather than a second number that can drift from it.
export const UPDATE_HZ = 30;
const UPDATE_INTERVAL_MS = 1000 / UPDATE_HZ;
export const FIXED_STEP_SECONDS = 1 / UPDATE_HZ;

// The most simulated time one timer fire may work through. Browsers throttle background tabs to
// roughly one setInterval fire per second, so this has to be at least a second or a hidden tab
// falls behind real time — which is the whole reason the simulation is on setInterval and not
// requestAnimationFrame. Anything beyond it (a sleeping laptop, a stalled main thread) is
// dropped rather than replayed: nobody wants an hour of datacenter simulated in one frame on
// resume.
const MAX_CATCH_UP_SECONDS = 1;

/**
 * How many fixed steps to run for `elapsedSeconds` of real time, given `carrySeconds` left over
 * from the previous fire, and what to carry into the next one. Backlog past MAX_CATCH_UP_SECONDS
 * is discarded.
 */
export function planFixedSteps(
  carrySeconds: number,
  elapsedSeconds: number,
): { steps: number; carrySeconds: number } {
  const pending = Math.min(carrySeconds + elapsedSeconds, MAX_CATCH_UP_SECONDS);
  const steps = Math.floor(pending / FIXED_STEP_SECONDS);
  return { steps, carrySeconds: pending - steps * FIXED_STEP_SECONDS };
}

export function createGameLoop({
  renderer,
  updateSystems,
  renderSystems,
  fps,
}: GameLoopDeps): GameLoop {
  let running = false;
  let lastUpdateTime = 0;
  let carrySeconds = 0;
  let updateHandle: ReturnType<typeof setInterval> | undefined;
  let renderHandle = 0;

  // setInterval keeps running on background/unfocused tabs (browsers only throttle it to
  // once/sec at worst); requestAnimationFrame is paused entirely by most browsers when the
  // tab isn't visible, so it's only used for rendering, which doesn't matter while unseen.
  //
  // Fixed step with catch-up, rather than handing systems whatever real delta arrived. A
  // throttled background tab fires once a second, so a per-fire delta CLAMP would advance the
  // world by that clamp and no more — a tenth of real time at the old 0.1s ceiling, silently
  // undoing the reason this is a timer at all. Running the elapsed time as N whole steps keeps
  // a hidden tab at real speed, and keeps every system on one step length so behaviour does not
  // depend on how busy the main thread was.
  function update(): void {
    if (!running) return;

    const now = performance.now();
    const elapsedSeconds = lastUpdateTime ? (now - lastUpdateTime) / 1000 : 0;
    lastUpdateTime = now;

    const plan = planFixedSteps(carrySeconds, elapsedSeconds);
    carrySeconds = plan.carrySeconds;

    for (let step = 0; step < plan.steps; step++) {
      for (const system of updateSystems) {
        system.update(FIXED_STEP_SECONDS);
      }
    }
  }

  function render(time: number): void {
    if (!running) return;

    fps.sample(time);
    renderer.clear();
    for (const system of renderSystems) {
      system.update(0);
    }

    renderHandle = requestAnimationFrame(render);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastUpdateTime = 0;
      carrySeconds = 0;
      updateHandle = setInterval(update, UPDATE_INTERVAL_MS);
      renderHandle = requestAnimationFrame(render);
    },
    stop() {
      running = false;
      clearInterval(updateHandle);
      cancelAnimationFrame(renderHandle);
    },
  };
}
