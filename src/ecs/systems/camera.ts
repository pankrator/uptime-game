import { type World, type EntityId } from '../world';
import { positions, buildModes, maintenanceTasks, dragStates } from '../components';
import { type Renderer } from '../../rendering';
import { type Camera } from '../../camera';
import { type InputStateTracker } from '../../input-state';
import { pointerInHud } from '../../ui/layout';
import { activeModal } from '../modal';
import { type System } from './system';

// Whether a press at `pointer` is allowed to pan the camera if it turns into a drag — the touch
// equivalent of WASD panning, since a touchscreen has no keyboard. This is a deliberately narrow
// subset of input.ts's full click-priority chain (HUD, build mode, an active install, an open
// rack/shop panel, an in-progress workload drag) — duplicated rather than shared, same
// trade-off as hud.ts's anyServerFits: this only needs a yes/no "is anything else claiming this
// gesture" check, not the full ordered chain, and it only ever affects camera framing
// (presentation), never game state, so a stale answer for one frame has no real consequence.
//
// No tutorial-banner check here: the banner isn't part of pointerInHud's blocking region —
// dragging over it pans the camera same as dragging any other empty floor, consistent with a
// click there falling through to the ordinary click chain.
function canPanCamera(
  world: World,
  renderer: Renderer,
  controlled: EntityId,
  pointer: { x: number; y: number },
): boolean {
  if (pointerInHud(pointer, renderer.canvas)) {
    return false;
  }

  if (world.getComponent(buildModes, controlled)) return false;
  if (world.getComponent(maintenanceTasks, controlled)) return false;
  if (world.getComponent(dragStates, controlled)) return false;
  if (activeModal(world, controlled) !== null) return false;

  return true;
}

// Runs in renderSystems, not updateSystems — presentation only, must not affect simulation
// when the tab is hidden. The game loop's render systems are always called with update(0)
// (rAF pauses in background tabs; wall-clock delta is tracked here instead so the camera still
// eases/pans smoothly while visible).
export function createCameraSystem(
  world: World,
  renderer: Renderer,
  inputState: InputStateTracker,
  controlled: EntityId,
  camera: Camera,
): System {
  let lastTime = 0;
  // Drag-to-pan gesture tracking — presentation-only transient state, kept here (not in the
  // ECS) for the same reason Camera's own `detached` flag isn't a component: it never affects
  // simulation and nothing else needs to read it.
  let dragPointer: { x: number; y: number } | null = null;
  let dragEligible = false;

  return {
    update() {
      const now = performance.now();
      const deltaSeconds = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0;
      lastTime = now;

      const position = world.getComponent(positions, controlled);
      if (!position) return;

      // Single-finger (or mouse) drag-to-pan. Eligibility is decided once, at the start of the
      // press; a real drag only actually moves the camera once movement is seen, so a
      // stationary tap (build placement, a panel button, walk-there) is never affected — those
      // still resolve entirely through input.ts's click chain, untouched by this.
      const state = inputState.getState();
      const pointerDown = state.mouseButtonsDown.has(0);
      const pointer = state.mousePosition;
      if (pointerDown && pointer) {
        if (dragPointer === null) {
          dragEligible = canPanCamera(world, renderer, controlled, pointer);
        } else if (dragEligible) {
          const dxScreen = pointer.x - dragPointer.x;
          const dyScreen = pointer.y - dragPointer.y;
          if (dxScreen !== 0 || dyScreen !== 0) {
            // Screen-space pointer movement to world-space pan: divide by zoom (worldToScreen
            // multiplies by scale, so this is its inverse), and negate — dragging the floor
            // right should move the camera's world origin left, same feel as grabbing a map.
            camera.pan(-dxScreen / camera.scale, -dyScreen / camera.scale);
          }
        }
        dragPointer = pointer;
      } else {
        dragPointer = null;
        dragEligible = false;
      }

      camera.update(deltaSeconds, position, renderer.canvas, inputState);
    },
  };
}
