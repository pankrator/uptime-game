# workload-spawn

`src/ecs/systems/workload-spawn.ts` — `createWorkloadSpawnSystem(world, facility)`,
`createOfferExpirySystem(world)`

## Purpose

Two small, related systems governing the offer lifecycle before a workload exists:
when new `Offer` entities arrive, and when an ignored offer auto-expires.

## `createWorkloadSpawnSystem`

- Reads/writes `DemandClock` (`elapsedSeconds`, `nextArrivalInSeconds`); reads `Reputation`
  and `Utilization.traitsTotal.cpu` on `facility`; reads existing `offers` count.
- Ticks the clock down; when it hits zero, picks a weighted-random archetype
  (`pickArchetype` — weights toward larger unlocked archetypes so unlocking a new one is
  noticeable) and calls `spawnOffer` (`src/entities.ts`), scaled by
  `getValueScale(elapsedSeconds, traitsTotal.cpu)` — installed/online facility CPU, not a
  completed job's own demand (see `.plans/compute-scale-fix.md` D1). `spawnOffer` itself
  derives a separately-capped demand scale from this same value (D2), so the offer's size
  never grows past what some machine tier can hold even once its pay keeps climbing.
- Capped at `MAX_OFFERS` concurrent offers — at the cap the clock still resets/keeps
  running but spawning is suppressed, so an idle player doesn't accumulate a backlog past
  the cap.

## `createOfferExpirySystem`

- Ticks every open `Offer.secondsRemaining` down; destroys the entity at zero.
- No reputation penalty on expiry — it destroys the offer directly rather than calling
  `declineOffer` in `dispatch.ts`, so `REPUTATION_ON_DECLINE` never applies. An ignored
  offer is a silent decline (no choice was made), unlike an explicit decline click, which
  costs `REPUTATION_ON_DECLINE` as of `.plans/contract-variety.md` step 3.

## Notes

- Offer → Workload conversion (on accept) lives in `dispatch.ts`'s `acceptOffer`, not
  here — this file only owns offers, never a live `Workload`. See
  [dispatch](../ecs-systems/README.md#core-ecs).
