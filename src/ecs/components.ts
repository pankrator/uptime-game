import { createComponentStore } from './world';

export const GRID_CELL_SIZE = 40;

export function worldToGrid(x: number, y: number): { gridX: number; gridY: number } {
  return {
    gridX: Math.floor(x / GRID_CELL_SIZE),
    gridY: Math.floor(y / GRID_CELL_SIZE),
  };
}

export interface Position {
  x: number;
  y: number;
}

export interface MoveTarget {
  x: number;
  y: number;
}

export interface Speed {
  pixelsPerSecond: number;
}

export interface GridPosition {
  gridX: number;
  gridY: number;
}

export type RenderableKind = 'player-circle' | 'rack';

export interface Renderable {
  kind: RenderableKind;
}

export const positions = createComponentStore<Position>();
export const moveTargets = createComponentStore<MoveTarget>();
export const speeds = createComponentStore<Speed>();
export const gridPositions = createComponentStore<GridPosition>();
export const renderables = createComponentStore<Renderable>();
