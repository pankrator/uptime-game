import { type Renderer } from '../rendering';
import { type InputState } from '../input';
import { type GameState } from '../state';
import { type System } from '../ecs/systems/system';

export interface GameLoopDeps {
  renderer: Renderer;
  input: InputState;
  state: GameState;
  systems: System[];
}

export interface GameLoop {
  start(): void;
  stop(): void;
}

export function createGameLoop({ renderer, systems }: GameLoopDeps): GameLoop {
  let running = false;
  let lastTimestamp = 0;
  let frameHandle = 0;

  function tick(timestamp: number): void {
    if (!running) return;

    const deltaSeconds = lastTimestamp ? (timestamp - lastTimestamp) / 1000 : 0;
    lastTimestamp = timestamp;

    renderer.clear();
    for (const system of systems) {
      system.update(deltaSeconds);
    }

    frameHandle = requestAnimationFrame(tick);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastTimestamp = 0;
      frameHandle = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frameHandle);
    },
  };
}
