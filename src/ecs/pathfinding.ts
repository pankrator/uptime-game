import { type World } from './world';
import { type GridCell, gridPositions, worldToGrid, GRID_CELL_SIZE, BUILDING_MARGIN } from './components';
import { type Renderer } from '../rendering';

export interface GridBounds {
  minGridX: number;
  minGridY: number;
  maxGridX: number;
  maxGridY: number;
}

export function getFloorGridBounds(canvas: Renderer['canvas']): GridBounds {
  const topLeft = worldToGrid(BUILDING_MARGIN, BUILDING_MARGIN);
  const bottomRight = worldToGrid(
    canvas.width - BUILDING_MARGIN,
    canvas.height - BUILDING_MARGIN,
  );
  return {
    minGridX: topLeft.gridX,
    minGridY: topLeft.gridY,
    maxGridX: bottomRight.gridX,
    maxGridY: bottomRight.gridY,
  };
}

function isInBounds(bounds: GridBounds, gridX: number, gridY: number): boolean {
  return (
    gridX >= bounds.minGridX &&
    gridX <= bounds.maxGridX &&
    gridY >= bounds.minGridY &&
    gridY <= bounds.maxGridY
  );
}

export function isWalkable(world: World, bounds: GridBounds, gridX: number, gridY: number): boolean {
  if (!isInBounds(bounds, gridX, gridY)) return false;
  return !world.query(gridPositions).some((id) => {
    const grid = world.getComponent(gridPositions, id)!;
    return grid.gridX === gridX && grid.gridY === gridY;
  });
}

function cellKey(cell: GridCell): string {
  return `${cell.gridX},${cell.gridY}`;
}

const NEIGHBOR_OFFSETS = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

function heuristic(a: GridCell, b: GridCell): number {
  return Math.abs(a.gridX - b.gridX) + Math.abs(a.gridY - b.gridY);
}

export function findPath(
  world: World,
  bounds: GridBounds,
  start: GridCell,
  goal: GridCell,
): GridCell[] | null {
  if (!isWalkable(world, bounds, goal.gridX, goal.gridY)) return null;
  if (start.gridX === goal.gridX && start.gridY === goal.gridY) return [];

  const startKey = cellKey(start);
  const goalKey = cellKey(goal);

  const openSet = new Map<string, GridCell>([[startKey, start]]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, heuristic(start, goal)]]);
  const cellByKey = new Map<string, GridCell>([[startKey, start]]);

  while (openSet.size > 0) {
    let currentKey: string | null = null;
    let currentF = Infinity;
    for (const key of openSet.keys()) {
      const f = fScore.get(key) ?? Infinity;
      if (f < currentF) {
        currentF = f;
        currentKey = key;
      }
    }
    if (currentKey === null) break;

    if (currentKey === goalKey) {
      const path: GridCell[] = [];
      let key: string | undefined = currentKey;
      while (key !== undefined) {
        path.unshift(cellByKey.get(key)!);
        key = cameFrom.get(key);
      }
      path.shift();
      return path;
    }

    const current = cellByKey.get(currentKey)!;
    openSet.delete(currentKey);

    for (const { dx, dy } of NEIGHBOR_OFFSETS) {
      const neighborX = current.gridX + dx;
      const neighborY = current.gridY + dy;
      if (!isWalkable(world, bounds, neighborX, neighborY)) continue;

      const neighbor: GridCell = { gridX: neighborX, gridY: neighborY };
      const neighborKey = cellKey(neighbor);
      const tentativeG = (gScore.get(currentKey) ?? Infinity) + 1;

      if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
        cameFrom.set(neighborKey, currentKey);
        gScore.set(neighborKey, tentativeG);
        fScore.set(neighborKey, tentativeG + heuristic(neighbor, goal));
        cellByKey.set(neighborKey, neighbor);
        if (!openSet.has(neighborKey)) {
          openSet.set(neighborKey, neighbor);
        }
      }
    }
  }

  return null;
}

export function findNearestWalkableNeighbor(
  world: World,
  bounds: GridBounds,
  cell: GridCell,
  from: GridCell,
): GridCell | null {
  let best: GridCell | null = null;
  let bestPath: GridCell[] | null = null;

  for (const { dx, dy } of NEIGHBOR_OFFSETS) {
    const candidate: GridCell = { gridX: cell.gridX + dx, gridY: cell.gridY + dy };
    if (!isWalkable(world, bounds, candidate.gridX, candidate.gridY)) continue;

    if (candidate.gridX === from.gridX && candidate.gridY === from.gridY) {
      return candidate;
    }

    const path = findPath(world, bounds, from, candidate);
    if (path === null) continue;

    if (bestPath === null || path.length < bestPath.length) {
      best = candidate;
      bestPath = path;
    }
  }

  return best;
}

export interface PixelPoint {
  x: number;
  y: number;
}

function hasLineOfSight(world: World, bounds: GridBounds, from: PixelPoint, to: PixelPoint): boolean {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.ceil(distance / (GRID_CELL_SIZE / 4));

  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const { gridX, gridY } = worldToGrid(x, y);
    if (!isWalkable(world, bounds, gridX, gridY)) return false;
  }

  return true;
}

/**
 * String-pulls a grid-cell path into the fewest straight pixel-space legs, so movement
 * cuts corners with clear line-of-sight instead of hopping through every cell center.
 */
export function simplifyPathToPixels(
  world: World,
  bounds: GridBounds,
  start: PixelPoint,
  path: GridCell[],
  end: PixelPoint,
): PixelPoint[] {
  const cellCenters = path.map((cell) => ({
    x: cell.gridX * GRID_CELL_SIZE + GRID_CELL_SIZE / 2,
    y: cell.gridY * GRID_CELL_SIZE + GRID_CELL_SIZE / 2,
  }));
  const points = [start, ...cellCenters, end];

  const simplified: PixelPoint[] = [];
  let anchorIndex = 0;

  for (let index = 1; index < points.length; index++) {
    const isLast = index === points.length - 1;
    if (!isLast && hasLineOfSight(world, bounds, points[anchorIndex], points[index + 1])) {
      continue;
    }
    simplified.push(points[index]);
    anchorIndex = index;
  }

  return simplified;
}
