// Generic, typed, synchronous pub/sub. Decouples the system that raises a domain event (e.g.
// "a machine just failed") from whatever reacts to it (e.g. play a sound), without either one
// importing the other — see game-events.ts for this game's concrete event map and
// .plans/event-bus.md for the design rationale and what deliberately still uses a direct call
// instead of this.
//
// Deliberately synchronous, not queued/deferred: emit() runs every subscribed handler
// immediately, in subscription order, before returning — this project's tick (main.ts's
// `updateSystems`, run in a documented, load-bearing order every frame) already fully
// determines WHEN an event fires; this bus only decouples WHO reacts to it, not when. A
// queued/deferred bus (drain a queue at a fixed point in the tick) would change that — an event
// emitted this frame wouldn't take effect until later — which is a real behavior change this
// project's tick-critical systems (resource/capacity/workload-run) don't want.
// No `extends Record<string, unknown>` constraint here on purpose: a plain interface (the shape
// every concrete event map, e.g. GameEvents, actually is) doesn't structurally satisfy that
// constraint without an explicit index signature, even when every property already fits — a
// well-known TS quirk. Events is used purely structurally (`keyof Events`, `Events[K]`), so no
// constraint is needed for that to work.
export interface EventBus<Events> {
  // Returns an unsubscribe function — same shape as InputState.onKeyDown, for the same reason
  // (a handler registered inside a system factory's closure may need to remove itself later).
  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): () => void;
  emit<K extends keyof Events>(type: K, payload: Events[K]): void;
}

export function createEventBus<Events>(): EventBus<Events> {
  const handlers = new Map<keyof Events, Set<(payload: never) => void>>();

  return {
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler as (payload: never) => void);
      const set_ = set;
      return () => set_.delete(handler as (payload: never) => void);
    },
    emit(type, payload) {
      const set = handlers.get(type);
      if (!set) return;
      // Snapshot before iterating: a handler that subscribes/unsubscribes (its own or another's)
      // in reaction to this same event must not affect the Set this emit() is already iterating.
      for (const handler of [...set]) {
        handler(payload as never);
      }
    },
  };
}
