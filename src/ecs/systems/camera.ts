import { type World, type EntityId } from '../world';
import { positions } from '../components';
import { type Renderer } from '../../rendering';
import { type Camera } from '../../camera';
import { type System } from './system';

// Runs in renderSystems, not updateSystems — presentation only, must not affect simulation
// when the tab is hidden (see .plans/facility-shop-inventory.md Step 1). The game loop's
// render systems are always called with update(0) (rAF pauses in background tabs; wall-clock
// delta is tracked here instead so the camera still eases smoothly while visible despite
// always being invoked with 0).
export function createCameraSystem(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  camera: Camera,
): System {
  let lastTime = 0;

  return {
    update() {
      const now = performance.now();
      const deltaSeconds = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0;
      lastTime = now;

      const position = world.getComponent(positions, controlled);
      if (!position) return;

      camera.update(deltaSeconds, position, renderer.canvas);
    },
  };
}
