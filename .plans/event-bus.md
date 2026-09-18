# Event bus

## Goal

Decouple systems that raise a domain-state notification from whichever system reacts to it, so
neither has to import the other. This was requested directly, generalizing a pattern the
codebase had already reached for independently twice: `ecs/modal.ts`'s `registerModalCloser`
(F6, `.plans/design-review.md`) lets `rack-panel.ts`/`shop.ts`/`job-panels.ts` each register how
to close themselves without importing each other; five systems
(`maintenance`/`resource`/`thermal`/`wear`/`workload-run`) each imported `Audio` directly just to
call `audio.play(soundName)` on their own state transition.

## Design

`src/ecs/event-bus.ts` — generic, typed `EventBus<Events>`:

```ts
interface EventBus<Events> {
  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): () => void;
  emit<K extends keyof Events>(type: K, payload: Events[K]): void;
}
```

**Deliberately synchronous, not queued/deferred.** `emit()` runs every subscribed handler
immediately, in subscription order, before returning. This project's tick
(`main.ts`'s `updateSystems`, run in a documented, load-bearing order every frame — see that
file's own "ORDER IS LOAD-BEARING" comment) already fully determines *when* something happens;
this bus only decouples *who* reacts to it, not *when*. A queued/deferred bus (drain a queue at
a fixed point in the tick) would change that — an event emitted this frame wouldn't take effect
until later, which is a real behavior change none of the tick-critical systems
(`resource`/`capacity`/`workload-run`, whose ordering `main.ts` documents at length) want. If a
genuine same-tick-but-after-everything-else use case shows up later, it can be built as one
more `updateSystems` entry that drains a queue — don't build that machinery speculatively now.

`src/ecs/game-events.ts` — this game's concrete `GameEvents` map. Payloads carry whatever id
the emitting system already has in hand at the call site (never more) — cheap to include, and
it's what makes an event actually useful to a listener instead of a content-free bell:

```ts
interface GameEvents {
  'machine:installed': { machineId: EntityId; rackId: EntityId };
  'machine:repaired': { machineId: EntityId };
  'machine:decommissioned': { machineId: EntityId };
  'machine:failed': { machineId: EntityId };
  'machine:browned-out': { machineId: EntityId };
  'machine:thermal-tripped': { machineId: EntityId; rackId: EntityId };
  'contract:completed': { workloadId: EntityId };
  'contract:missed': { workloadId: EntityId };
}
```

`machine:browned-out` (resource.ts, a capacity brownout) and `machine:thermal-tripped`
(thermal.ts, an overheating trip) are kept as two event types even though both currently play
the identical sound — they're different causes, and collapsing them into one event name would
throw away information a future listener (a toast, a tutorial step) would want back.

One `EventBus<GameEvents>` instance is created once in `main.ts`'s `runGame()`, alongside
`audio`/`camera`, and threaded into every system factory that emits — same pattern as those,
not a module-level singleton. `World` itself already sets this precedent deliberately (created
fresh per test/run, not a singleton) over `components.ts`'s stores (a documented, narrower
exception — see F12, `.plans/design-review.md`); a singleton bus would need its own reset
mechanism to keep tests isolated, for no benefit over just constructing one per run/test.

`src/ecs/audio-events.ts`'s `wireAudioEvents(events, audio)` is the one place mapping an event
to a sound — called once, the same "wire it up once, outside any system's `update()`" treatment
`registerModalCloser` calls already get.

## What moved

`maintenance.ts`, `resource.ts`, `thermal.ts`, `wear.ts`, `workload-run.ts` — each used `Audio`
for exactly one thing (a single `audio.play(...)` call on its own state transition), so each
drops the `Audio` parameter entirely and takes `EventBus<GameEvents>` instead, emitting rather
than playing. This is a real, checkable reduction in coupling: five fewer things that need to
know `Audio` exists, visible directly in their function signatures.

## What deliberately did NOT move — this is not a blanket replacement

The request was "generally replace all one-off calls between systems with an event bus." That
scope, taken literally, would mean routing every cross-module function call in the systems
layer — `dispatch.ts`'s `placeWorkload`/`checkPlacement`/`unplaceWorkload`/`acceptOffer`/
`declineOffer`, `maintenance.ts`'s `startInstall`/`startRepair`/`startDecommission`, every
`handleXClick` function F7 built, `moveControlledTo` — through `emit`/`on` instead. That's the
wrong shape for most of what's actually in this codebase, for a concrete reason in each case,
not a general one:

- **Commands with a return value or a precondition the caller acts on** — `checkPlacement`
  returns which traits block a drop so the caller can flash them red; `acceptOffer` returns the
  new workload id; `startRepair` no-ops (and the caller needs to know it did) if a maintenance
  task is already running. A `void`-handler pub/sub has nowhere to put a return value, and "did
  anyone actually handle this" isn't answerable from `emit()`'s side. These are commands, not
  notifications — matches this project's other command modules (`dispatch.ts`, `inventory.ts`)
  in shape, and changing that shape to fit a bus that doesn't need it would make the caller code
  worse, not better.
- **One clear owner, called from exactly one place** — `handleRackPanelClick`/`handleShopClick`/
  `handleOffersModalClick`/`handleJobsModalClick` (F7) are already the single, obvious place
  each panel's clicks are handled; `input.ts`'s click-priority chain calls exactly one of them
  per click, by design (only one modal is ever open — see F6/the modal-consolidation work).
  There is no second listener to decouple from, so routing this through a bus adds a layer with
  no independent reader on the other end — pure ceremony.
- **Tick-critical, ordering-dependent mutations** — `resource.ts`/`capacity.ts`/
  `workload-run.ts`'s calls into `dispatch.ts` must happen synchronously, in the exact tick
  position `main.ts`'s load-bearing order already puts them in, for the next system in that
  order to see correct state. The event bus already used here is synchronous for exactly this
  reason (see Design above), but even a synchronous `emit` doesn't help when the "handler" IS
  the very next line of the same function, with no independent listener — it would just be an
  indirect way to call a function, not a decoupling.

The rule that actually decided each of the five migrated calls: **the emitting system doesn't
need to know who's listening, doesn't need a return value, and more than one thing could
plausibly want to know** (audio today; a toast or a tutorial step plausibly tomorrow, which is
exactly why `game-events.ts`'s payloads carry an id rather than nothing). None of the "did not
move" call sites meet that bar. This mirrors `.plans/design-review.md`'s own "Deliberately not
proposed" convention — recording the rejection is as useful as recording the change, so the
next person doesn't re-litigate it from scratch.

## Verification

- `event-bus.ts` is pure and unit-tested in isolation (`event-bus.test.ts`) — subscription
  order, multiple event types on one bus, unsubscribe (including a handler unsubscribing itself
  mid-`emit`), and the no-op case when nothing is subscribed.
- `resource.test.ts`, `wear.test.ts`, `workload-run.test.ts` each gained an assertion on the
  specific event now emitted (previously untestable, since asserting "was `audio.play` called"
  needed a spy on a stub that existed only to satisfy the type) — a small net gain for F16
  (`.plans/design-review.md`)'s "untested surface" concern, not just a mechanical signature
  change.
- `simulation.test.ts`'s multi-system sustained run and the full suite stay green with the new
  wiring in place.
- Manual check (per CLAUDE.md — no browser automation): install, repair, decommission a
  machine; let a workload complete and let one miss its deadline; force a brownout (overload
  power) and a thermal trip. Every one of those should still play its sound exactly as before —
  the whole point of this change is that *what plays* didn't move, only *how the system that
  caused it tells anyone*.
