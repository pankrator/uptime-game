import { type Renderer } from '../rendering';
import { type InputState } from '../input';
import { type GameState } from '../state';
import { type System } from '../ecs/systems/system';

export interface GameLoopDeps {
  renderer: Renderer;
  input: InputState;
  state: GameState;
  updateSystems: System[];
  renderSystems: System[];
}

export interface GameLoop {
  start(): void;
  stop(): void;
}

const UPDATE_HZ = 30;
const UPDATE_INTERVAL_MS = 1000 / UPDATE_HZ;
const MAX_DELTA_SECONDS = 0.1;

export function createGameLoop({ renderer, updateSystems, renderSystems }: GameLoopDeps): GameLoop {
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

  function render(): void {
    if (!running) return;

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
