# path-follow

`src/ecs/systems/path-follow.ts` — `createPathFollowSystem(world)`

## Purpose

Drains a queued `PathFollow.path` into `movement`'s `MoveTarget`, one waypoint per
arrival, so a multi-waypoint path (from `pathfinding.ts`) plays out over several
movement legs instead of needing `movement` to understand paths at all.

## Reads / writes

- Query: `pathFollows`
- Reads `moveTargets` to know whether the current leg is still in flight (skips entities
  that already have a `MoveTarget`)
- Writes: `MoveTarget` (next waypoint); removes `PathFollow` once the path is exhausted

## Notes

- Entities are typically given a `PathFollow` by `input.ts`'s `moveControlledTo`, which
  runs `pathfinding.ts` and hands the simplified pixel path to this component.
- Runs before `movement` in `main.ts`'s `updateSystems` so a freshly-set waypoint is
  picked up the same tick.
