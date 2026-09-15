# movement

`src/ecs/systems/movement.ts` — `createMovementSystem(world)`

## Purpose

Moves any entity with a `Position` toward its `MoveTarget` at `Speed.pixelsPerSecond`,
removing `MoveTarget` once reached. The single place position interpolation happens —
nothing else writes to `Position` directly for movement.

## Reads / writes

- Query: `positions`, `moveTargets`, `speeds`
- Writes: `Position.x/y` each tick; removes `MoveTarget` on arrival

## Notes

- Snaps to the exact target if the remaining distance is smaller than this tick's step,
  so it never overshoots regardless of frame rate.
- No pathfinding here — `MoveTarget` is assumed to already be a safe, reachable point.
  Pathing around obstacles is `path-follow`'s job, which feeds this system one waypoint
  at a time.
