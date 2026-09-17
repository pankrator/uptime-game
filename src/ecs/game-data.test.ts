import { describe, it, expect } from 'vitest';
import {
  clampReputation,
  getArrivalInterval,
  getValueScale,
  getDemandScale,
  MAX_DEMAND_SCALE,
  MACHINE_TIERS,
  WORKLOAD_ARCHETYPES,
  CAPACITY_SCALE_CPU_DIVISOR,
  TRAIT_KEYS,
} from './game-data';

describe('clampReputation', () => {
  it('clamps to [0, 100]', () => {
    expect(clampReputation(-10)).toBe(0);
    expect(clampReputation(150)).toBe(100);
    expect(clampReputation(50)).toBe(50);
  });
});

describe('getArrivalInterval', () => {
  it('shrinks as reputation rises (offers arrive faster at higher reputation)', () => {
    const lowRep = getArrivalInterval(0, 0);
    const highRep = getArrivalInterval(0, 100);
    expect(highRep).toBeLessThan(lowRep);
  });

  it('shrinks as elapsed time rises, down to its floor', () => {
    const early = getArrivalInterval(0, 50);
    const late = getArrivalInterval(10_000, 50);
    expect(late).toBeLessThan(early);
  });

  it('never returns a non-positive interval', () => {
    expect(getArrivalInterval(100_000, 100)).toBeGreaterThan(0);
  });
});

// The .plans/playtest-findings.md B3 regression: getValueScale used to be keyed off the single
// largest COMPLETED workload's cpu demand (peakComputeServed), which the catalog caps at 12 —
// so capacityScale could never exceed max(1, 12/30) = 1, permanently pinning the whole function
// at 1x regardless of how the facility played. It is now keyed off installed/online facility
// CPU instead. This test asserts the property whose absence WAS the bug: value scale must be
// able to climb past 1 as the facility's own installed capacity grows.
describe('getValueScale (B3 regression: capacity scale must track facility capacity, not a single completed job)', () => {
  it('is pinned at 1x for a facility with no installed capacity, regardless of elapsed time', () => {
    expect(getValueScale(0, 0)).toBe(1);
    expect(getValueScale(10_000, 0)).toBe(1);
  });

  // getValueScale is min(timeScale, capacityScale) — elapsed time is ALSO a ramp (see D1's
  // "bounded by both a time ramp and the player's demonstrated capacity"), so these tests fix
  // elapsedSeconds past the time ramp's own 10-minute ceiling to isolate capacity's effect.
  const TIME_RAMP_COMPLETE_SECONDS = 700; // >600s: 1 + min(2, elapsed/300) has reached its cap of 3

  it('grows past 1x as installed facility CPU grows — this is exactly what B3 could never do', () => {
    const atCatalogCeiling = getValueScale(TIME_RAMP_COMPLETE_SECONDS, 12); // the old bug's hard ceiling
    const wellPast = getValueScale(TIME_RAMP_COMPLETE_SECONDS, 300);
    expect(wellPast).toBeGreaterThan(atCatalogCeiling);
    expect(wellPast).toBeGreaterThan(1);
  });

  it('reaches its 3x ceiling once facility CPU clears the divisor 3x over', () => {
    expect(getValueScale(TIME_RAMP_COMPLETE_SECONDS, CAPACITY_SCALE_CPU_DIVISOR * 3)).toBeCloseTo(3);
    expect(getValueScale(TIME_RAMP_COMPLETE_SECONDS, CAPACITY_SCALE_CPU_DIVISOR * 100)).toBeCloseTo(3); // still capped
  });

  it('is capped by the time ramp too — capacity alone cannot exceed the 3x ceiling', () => {
    expect(getValueScale(TIME_RAMP_COMPLETE_SECONDS, CAPACITY_SCALE_CPU_DIVISOR * 100)).toBeLessThanOrEqual(3);
  });

  it('at elapsedSeconds=0, time itself caps scale at 1x regardless of installed capacity', () => {
    expect(getValueScale(0, CAPACITY_SCALE_CPU_DIVISOR * 100)).toBe(1);
  });
});

describe('getDemandScale', () => {
  it('tracks valueScale below the catalog fit ceiling', () => {
    const archetypeId = 'web';
    expect(getDemandScale(archetypeId, 1)).toBe(1);
  });

  it('clamps to MAX_DEMAND_SCALE once valueScale exceeds what any tier can fit (compute-scale-fix D2)', () => {
    const archetypeId = 'training'; // the tightest-fitting archetype, most likely to hit its ceiling
    const scale = getDemandScale(archetypeId, 1000);
    expect(scale).toBe(MAX_DEMAND_SCALE[archetypeId]);
    expect(scale).toBeLessThan(1000);
  });

  it('MAX_DEMAND_SCALE is computed such that every archetype fits at least one tier at that scale', () => {
    for (const archetype of Object.values(WORKLOAD_ARCHETYPES)) {
      const scale = MAX_DEMAND_SCALE[archetype.id];
      const fitsSomeTier = Object.values(MACHINE_TIERS).some((tier) =>
        TRAIT_KEYS.every((key) => archetype.demands[key] * scale <= tier.traits[key] + 0.5),
      );
      expect(fitsSomeTier).toBe(true);
    }
  });
});

describe('catalog sanity (guards against silently reintroducing the Step 9 tuning bug)', () => {
  it('every workload archetype fits at least one machine tier at scale 1', () => {
    for (const archetype of Object.values(WORKLOAD_ARCHETYPES)) {
      const fitsSomeTier = Object.values(MACHINE_TIERS).some((tier) =>
        TRAIT_KEYS.every((key) => archetype.demands[key] <= tier.traits[key]),
      );
      expect(fitsSomeTier).toBe(true);
    }
  });
});
