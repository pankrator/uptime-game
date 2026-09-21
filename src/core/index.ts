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
const MAX_DELTA_SECONDS = 0.1;

export function createGameLoop({
  renderer,
  updateSystems,
  renderSystems,
  fps,
}: GameLoopDeps): GameLoop {
  let running = false;
  let lastUpdateTime = 0;
  let updateHandle: ReturnType<typeof setInterval> | undefined;
  let renderHandle = 0;

  // setInterval keeps running on background/unfocused tabs (browsers only throttle it to
  // once/sec at worst); requestAnimationFrame is paused entirely by most browsers when the
  // tab isn't visible, so it's only used for rendering, which doesn't matter while unseen.
  function update(): void {
    if (!running) return;

    const now = performance.now();
    const rawDelta = lastUpdateTime ? (now - lastUpdateTime) / 1000 : 0;
    const deltaSeconds = Math.min(rawDelta, MAX_DELTA_SECONDS);
    lastUpdateTime = now;

    for (const system of updateSystems) {
      system.update(deltaSeconds);
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
