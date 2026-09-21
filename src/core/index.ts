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

const UPDATE_HZ = 30;
const UPDATE_INTERVAL_MS = 1000 / UPDATE_HZ;
const MAX_DELTA_SECONDS = 0.1;

// Caps redraw rate independent of the display's refresh rate — a bare requestAnimationFrame
// loop redraws the full scene (background texture, floor grid, every rack, HUD) once per
// display refresh, which on a 120Hz panel is double the draw calls of a 60Hz one for no visible
// benefit in a canvas game with no fast twitch gameplay. Below this cap, unthrottled 30Hz+
// rendering is already smooth.
const RENDER_HZ = 60;
const RENDER_INTERVAL_MS = 1000 / RENDER_HZ;

export function createGameLoop({ renderer, updateSystems, renderSystems, fps }: GameLoopDeps): GameLoop {
  let running = false;
  let lastUpdateTime = 0;
  let lastRenderTime = 0;
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
    renderHandle = requestAnimationFrame(render);

    if (time - lastRenderTime < RENDER_INTERVAL_MS) return;
    lastRenderTime = time;

    fps.sample(time);
    renderer.clear();
    for (const system of renderSystems) {
      system.update(0);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastUpdateTime = 0;
      lastRenderTime = 0;
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
