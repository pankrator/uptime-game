import { describe, it, expect } from 'vitest';
import { createWorld } from './world';
import { gridPositions } from './components';
import { findPath, findNearestWalkableNeighbor, type GridBounds } from './pathfinding';
import type { WorldRegions } from './world-map';

// A single 6x6 open region, no obstacles unless a test adds one — enough to exercise A* without
// needing a real room/corridor/shop layout (world-map.ts).
function openRegion(): WorldRegions {
  const bounds: GridBounds = { minGridX: 0, minGridY: 0, maxGridX: 5, maxGridY: 5 };
  return { regions: [bounds] };
}

describe('findPath', () => {
  it('returns an empty path when already at the goal', () => {
    const world = createWorld();
    const path = findPath(world, openRegion(), { gridX: 2, gridY: 2 }, { gridX: 2, gridY: 2 });
    expect(path).toEqual([]);
  });

  it('finds a shortest Manhattan path across open ground, excluding the start cell', () => {
    const world = createWorld();
    const path = findPath(world, openRegion(), { gridX: 0, gridY: 0 }, { gridX: 2, gridY: 0 });
    expect(path).not.toBeNull();
    expect(path).toHaveLength(2); // start cell excluded from the returned path
    expect(path![path!.length - 1]).toEqual({ gridX: 2, gridY: 0 });
  });

  it('returns null when the goal is outside every walkable region', () => {
    const world = createWorld();
    const path = findPath(world, openRegion(), { gridX: 0, gridY: 0 }, { gridX: 99, gridY: 99 });
    expect(path).toBeNull();
  });

  it('returns null when the goal cell itself is occupied by another entity', () => {
    const world = createWorld();
    const blockerId = world.createEntity();
    world.addComponent(gridPositions, blockerId, { gridX: 3, gridY: 3 });

    const path = findPath(world, openRegion(), { gridX: 0, gridY: 0 }, { gridX: 3, gridY: 3 });
    expect(path).toBeNull();
  });

  it('routes around an obstacle rather than failing, when a detour exists', () => {
    const world = createWorld();
    // Block every cell in column x=2 except one gap at y=5, forcing a detour down and around.
    for (let y = 0; y <= 4; y++) {
      const id = world.createEntity();
      world.addComponent(gridPositions, id, { gridX: 2, gridY: y });
    }
    const path = findPath(world, openRegion(), { gridX: 0, gridY: 0 }, { gridX: 4, gridY: 0 });
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ gridX: 4, gridY: 0 });
    // Must be longer than the unobstructed Manhattan distance (4) since it detours through y=5.
    expect(path!.length).toBeGreaterThan(4);
  });
});

describe('findNearestWalkableNeighbor', () => {
  it('finds an open cell adjacent to a blocked target', () => {
    const world = createWorld();
    const target = { gridX: 3, gridY: 3 };
    const from = { gridX: 0, gridY: 0 };
    const neighbor = findNearestWalkableNeighbor(world, openRegion(), target, from);
    expect(neighbor).not.toBeNull();
    const dx = Math.abs(neighbor!.gridX - target.gridX);
    const dy = Math.abs(neighbor!.gridY - target.gridY);
    expect(dx + dy).toBe(1); // orthogonally adjacent
  });

  it('returns null when the target has no walkable neighbor at all', () => {
    const world = createWorld();
    // Isolate (1,1) inside a 1-cell region so it has zero in-region neighbors.
    const isolated: WorldRegions = { regions: [{ minGridX: 1, minGridY: 1, maxGridX: 1, maxGridY: 1 }] };
    const neighbor = findNearestWalkableNeighbor(world, isolated, { gridX: 1, gridY: 1 }, { gridX: 1, gridY: 1 });
    expect(neighbor).toBeNull();
  });
});
