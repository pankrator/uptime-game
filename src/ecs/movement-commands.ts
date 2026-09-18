// One-shot "walk here" command: resolves a target pixel to a walkable goal, computes a path via
// pathfinding.ts, and queues it as a PathFollow. Distinct from movement.ts (per-tick
// MoveTarget -> Position stepping) and path-follow.ts (per-tick PathFollow -> MoveTarget
// feeding) — this is the entry point that starts a walk, called from click handlers across
// systems (input.ts's floor/rack clicks, maintenance.ts's install/repair/decommission dispatch)
// that would otherwise need to import it from one another.
import { type World, type EntityId } from './world';
import { positions, moveTargets, pathFollows, gridToWorld, worldToGrid } from './components';
import {
  isWalkable,
  findPath,
  findNearestWalkableNeighbor,
  simplifyPathToPixels,
} from './pathfinding';
import { getWalkableRegions } from './world-map';

export function moveControlledTo(
  world: World,
  controlled: EntityId,
  facility: EntityId,
  targetPixel: { x: number; y: number },
): void {
  const position = world.getComponent(positions, controlled);
  if (!position) return;

  const regions = getWalkableRegions(world, facility);
  const start = worldToGrid(position.x, position.y);
  const { gridX: targetGridX, gridY: targetGridY } = worldToGrid(targetPixel.x, targetPixel.y);

  const targetIsWalkable = isWalkable(world, regions, targetGridX, targetGridY);
  const goal = targetIsWalkable
    ? { gridX: targetGridX, gridY: targetGridY }
    : findNearestWalkableNeighbor(
        world,
        regions,
        { gridX: targetGridX, gridY: targetGridY },
        start,
      );

  if (!goal) return;

  const path = findPath(world, regions, start, goal);
  if (path === null) return;

  // Exact click point when it's reachable; otherwise the neighbor cell's center, since the
  // click landed on an obstacle and there's no exact point on it to walk to.
  const endPixel = targetIsWalkable ? targetPixel : gridToWorld(goal.gridX, goal.gridY);

  world.removeComponent(moveTargets, controlled);

  const simplified = simplifyPathToPixels(world, regions, position, path, endPixel);
  world.addComponent(pathFollows, controlled, { path: simplified, index: 0 });
}
