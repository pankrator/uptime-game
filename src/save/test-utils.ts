// Test-only helper shared by registry.test.ts and round-trip.test.ts.
//
// Resetting component stores between/within tests is NOT this file's job any more — that's
// ecs/world.ts's resetAllComponentStores(), wired into every test globally via
// src/test/setup.ts. This file keeps only the one helper that's specific to the save registry:
// duck-typing a ComponentStore among components.ts's other exports.
export function isComponentStore(value: unknown): value is { map: Map<unknown, unknown> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'map' in value &&
    (value as { map: unknown }).map instanceof Map
  );
}
