# camera

`src/ecs/systems/camera.ts` — `createCameraSystem(world, renderer, controlled, camera)`

## Purpose

Eases the `Camera` (see `src/camera/index.ts`) toward the controlled entity's `Position`
every frame. Pure presentation — must never affect simulation state. The camera only ever
tracks the controlled entity — there is no mouse-edge-pan or manual keyboard pan; it always
follows.

## Reads / writes

- Reads: `Position` of `controlled`
- Writes: none in the ECS — mutates the external `Camera` object

## Notes

- Lives in `renderSystems`, not `updateSystems`. `renderSystems` are called with
  `update(0)` while the tab is hidden (rAF pauses in background tabs), so this system
  tracks its own wall-clock delta via `performance.now()` internally rather than trusting
  the passed-in `deltaSeconds` — that's why it still eases smoothly while visible despite
  always being invoked with `0`.
- Clamps its internal delta to 100ms to avoid a large camera jump after a long pause
  (e.g. returning to the tab).
