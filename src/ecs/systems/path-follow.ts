import { type World } from '../world';
import { moveTargets, pathFollows } from '../components';
import { type System } from './system';

export function createPathFollowSystem(world: World): System {
  return {
    update() {
      for (const id of world.query(pathFollows)) {
        if (world.getComponent(moveTargets, id)) continue;

        const pathFollow = world.getComponent(pathFollows, id)!;
        if (pathFollow.index >= pathFollow.path.length) {
          world.removeComponent(pathFollows, id);
          continue;
        }

        const waypoint = pathFollow.path[pathFollow.index];
        pathFollow.index += 1;
        world.addComponent(moveTargets, id, { x: waypoint.x, y: waypoint.y });
      }
    },
  };
}
