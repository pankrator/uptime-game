export type Scene = 'loading' | 'playing' | 'paused';

export interface GameState {
  scene: Scene;
}

export function createGameState(): GameState {
  return {
    scene: 'loading',
  };
}
