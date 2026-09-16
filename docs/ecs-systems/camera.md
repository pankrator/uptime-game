# camera

`src/ecs/systems/camera.ts` — `createCameraSystem(world, renderer, input, controlled, camera)`

## Purpose

Eases the `Camera` (see `src/camera/index.ts`) toward the controlled entity's `Position`
every frame. Pure presentation — must never affect simulation state. WASD pans the camera
manually; there is no mouse-edge-pan. Space re-centers on the controlled entity and resumes
following.

## Reads / writes

- Reads: `Position` of `controlled`, WASD/space key state from `input`
- Writes: none in the ECS — mutates the external `Camera` object

## Notes

- Lives in `renderSystems`, not `updateSystems`. `renderSystems` are called with
  `update(0)` while the tab is hidden (rAF pauses in background tabs), so this system
  tracks its own wall-clock delta via `performance.now()` internally rather than trusting
  the passed-in `deltaSeconds` — that's why it still eases/pans smoothly while visible
  despite always being invoked with `0`.
- Clamps its internal delta to 100ms to avoid a large camera jump after a long pause
  (e.g. returning to the tab).
- WASD panning sets an internal `detached` flag that suspends following until space is
  pressed — otherwise pan and follow would fight every frame.
