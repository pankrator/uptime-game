import { describe, it, expect } from 'vitest';
import { zeroTraits, addTraits, subtractTraits, scaleTraits, fits, shortfall } from './traits';
import { TRAIT_KEYS, type Traits } from './game-data';

describe('zeroTraits', () => {
  it('is zero on every trait key', () => {
    const zero = zeroTraits();
    for (const key of TRAIT_KEYS) expect(zero[key]).toBe(0);
  });
});

describe('addTraits / subtractTraits', () => {
  const a: Traits = { cpu: 8, ramGb: 32, storageGb: 1000 };
  const b: Traits = { cpu: 2, ramGb: 8, storageGb: 100 };

  it('adds per key', () => {
    expect(addTraits(a, b)).toEqual({ cpu: 10, ramGb: 40, storageGb: 1100 });
  });

  it('subtracts per key', () => {
    expect(subtractTraits(a, b)).toEqual({ cpu: 6, ramGb: 24, storageGb: 900 });
  });

  it('subtract is the inverse of add', () => {
    expect(subtractTraits(addTraits(a, b), b)).toEqual(a);
  });

  it('can go negative — capacity overcommit is representable, not clamped away silently', () => {
    expect(subtractTraits(b, a)).toEqual({ cpu: -6, ramGb: -24, storageGb: -900 });
  });
});

describe('scaleTraits', () => {
  it('scales and rounds each key independently', () => {
    expect(scaleTraits({ cpu: 2, ramGb: 8, storageGb: 100 }, 1.5)).toEqual({
      cpu: 3,
      ramGb: 12,
      storageGb: 150,
    });
  });

  it('rounds fractional results to the nearest integer', () => {
    // 6 * 1.33 = 7.98 -> 8
    expect(scaleTraits({ cpu: 6, ramGb: 0, storageGb: 0 }, 1.33).cpu).toBe(8);
  });

  it('factor 1 is the identity', () => {
    const t: Traits = { cpu: 6, ramGb: 20, storageGb: 800 };
    expect(scaleTraits(t, 1)).toEqual(t);
  });
});

describe('fits', () => {
  const free: Traits = { cpu: 8, ramGb: 32, storageGb: 1000 };

  it('true when every demand is within free capacity', () => {
    expect(fits({ cpu: 8, ramGb: 32, storageGb: 1000 }, free)).toBe(true);
    expect(fits({ cpu: 2, ramGb: 8, storageGb: 100 }, free)).toBe(true);
  });

  it('false when any single trait exceeds free capacity', () => {
    expect(fits({ cpu: 9, ramGb: 1, storageGb: 1 }, free)).toBe(false);
  });
});

describe('shortfall', () => {
  const free: Traits = { cpu: 4, ramGb: 32, storageGb: 1000 };

  it('empty when the demand fits', () => {
    expect(shortfall({ cpu: 4, ramGb: 8, storageGb: 100 }, free)).toEqual([]);
  });

  it('lists exactly the trait keys that block placement', () => {
    expect(shortfall({ cpu: 8, ramGb: 16, storageGb: 2000 }, free)).toEqual(['cpu', 'storageGb']);
  });
});
