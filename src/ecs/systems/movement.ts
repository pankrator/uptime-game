import { type World } from '../world';
import { positions, moveTargets, speeds } from '../components';
import { type System } from './system';

export function createMovementSystem(world: World): System {
  return {
    update(deltaSeconds: number) {
      for (const id of world.query(positions, moveTargets, speeds)) {
        const position = world.getComponent(positions, id)!;
        const target = world.getComponent(moveTargets, id)!;
        const speed = world.getComponent(speeds, id)!;

        const dx = target.x - position.x;
        const dy = target.y - position.y;
        const distance = Math.hypot(dx, dy);
        const step = speed.pixelsPerSecond * deltaSeconds;

        if (distance <= step) {
          position.x = target.x;
          position.y = target.y;
          world.removeComponent(moveTargets, id);
        } else {
          position.x += (dx / distance) * step;
          position.y += (dy / distance) * step;
        }
      }
    },
  };
}
