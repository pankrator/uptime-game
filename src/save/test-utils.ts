// Test-only helpers shared by registry.test.ts and round-trip.test.ts.
import * as components from '../ecs/components';

// Duck-types a ComponentStore (`{ map: Map<EntityId, T> }`) among components.ts's other
// exports (types, constants, functions) — see world.ts's ComponentStore definition.
export function isComponentStore(value: unknown): value is { map: Map<unknown, unknown> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'map' in value &&
    (value as { map: unknown }).map instanceof Map
  );
}

// Component stores are module-level singletons (components.ts creates each one exactly once
// and every `World` reads/writes the SAME Map) — only `World.createEntity`'s id counter and
// `entities` Set are actually per-instance. The real app never notices: it creates exactly one
// `World` per page load. Tests do notice, the moment two `World`s exist in the same process —
// their id sequences both start at 1 and collide in these shared Maps. Clearing every store
// between tests (and before reusing a store for a second `World`, as round-trip.test.ts does)
// keeps each test's `World` instances from bleeding into each other.
export function clearAllComponentStores(): void {
  for (const value of Object.values(components)) {
    if (isComponentStore(value)) value.map.clear();
  }
}
