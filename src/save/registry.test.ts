import { describe, expect, it } from 'vitest';
import * as components from '../ecs/components';
import { SAVE_COMPONENTS, TRANSIENT_COMPONENTS } from './registry';
import { isComponentStore } from './test-utils';

// A new component that nobody classified as persistent or explicitly transient fails here, at
// test time — not silently at save time by just being missing from whoever's save file needed
// it.
describe('save component registry', () => {
  it('classifies every ComponentStore export of components.ts as persistent or transient', () => {
    const persistent = new Set(SAVE_COMPONENTS.map((entry) => entry.store));
    const transient = new Set(TRANSIENT_COMPONENTS);

    // A plain loop (not a `.filter().filter()` chain) so the `isComponentStore` type guard
    // actually narrows `value` for the `persistent`/`transient` lookups below — narrowing
    // doesn't survive being wrapped in an intermediate arrow function passed to `.filter`.
    const unclassified: string[] = [];
    for (const [name, value] of Object.entries(components)) {
      if (!isComponentStore(value)) continue;
      if (!persistent.has(value) && !transient.has(value)) unclassified.push(name);
    }

    expect(unclassified).toEqual([]);
  });

  it('never lists the same store as both persistent and transient', () => {
    const transient = new Set(TRANSIENT_COMPONENTS);
    const overlap = SAVE_COMPONENTS.filter((entry) => transient.has(entry.store)).map(
      (entry) => entry.key,
    );

    expect(overlap).toEqual([]);
  });

  it('uses a unique key for every persisted component', () => {
    const keys = SAVE_COMPONENTS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
