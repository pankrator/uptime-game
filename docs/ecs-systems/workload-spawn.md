# workload-spawn

`src/ecs/systems/workload-spawn.ts` — `createWorkloadSpawnSystem(world, facility)`,
`createOfferExpirySystem(world)`

## Purpose

Two small, related systems governing the offer lifecycle before a workload exists:
when new `Offer` entities arrive, and when an ignored offer auto-expires.

## `createWorkloadSpawnSystem`

- Reads/writes `DemandClock` (`elapsedSeconds`, `nextArrivalInSeconds`) and `Reputation`
  on `facility`; reads existing `offers` count.
- Ticks the clock down; when it hits zero, picks a weighted-random archetype
  (`pickArchetype` — weights toward larger unlocked archetypes so unlocking a new one is
  noticeable) and calls `spawnOffer` (`src/entities.ts`), scaled by
  `getComputeScale(elapsedSeconds, peakComputeServed)`.
- Capped at `MAX_OFFERS` concurrent offers — at the cap the clock still resets/keeps
  running but spawning is suppressed, so an idle player doesn't accumulate a backlog past
  the cap.

## `createOfferExpirySystem`

- Ticks every open `Offer.secondsRemaining` down; destroys the entity at zero.
- No reputation penalty on expiry — an ignored offer is treated as a silent decline,
  same as `declineOffer` in `dispatch.ts` (`REPUTATION_ON_DECLINE = 0`).

## Notes

- Offer → Workload conversion (on accept) lives in `dispatch.ts`'s `acceptOffer`, not
  here — this file only owns offers, never a live `Workload`. See
  [dispatch](../ecs-systems/README.md#core-ecs).
