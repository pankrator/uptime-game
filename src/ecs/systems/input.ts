import { type World, type EntityId } from '../world';
import { moveTargets, gridPositions, worldToGrid } from '../components';
import { type InputState } from '../../input';
import { spawnRack } from '../../entities';
import { type System } from './system';

export function createInputSystem(world: World, input: InputState, controlled: EntityId): System {
  return {
    update() {
      if (!input.wasClicked()) return;

      const pointer = input.getPointerPosition();
      if (!pointer) return;

      const { gridX, gridY } = worldToGrid(pointer.x, pointer.y);
      const occupied = world
        .query(gridPositions)
        .some((id) => {
          const grid = world.getComponent(gridPositions, id)!;
          return grid.gridX === gridX && grid.gridY === gridY;
        });

      if (occupied) {
        world.addComponent(moveTargets, controlled, { x: pointer.x, y: pointer.y });
        return;
      }

      spawnRack(world, gridX, gridY);
    },
  };
}
