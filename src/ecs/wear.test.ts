import { describe, it, expect } from 'vitest';
import {
  heatWearMultiplier,
  wearGain,
  failureChancePerSecond,
  rollFailure,
  applyRepair,
  repairCost,
  repairSeconds,
} from './wear';
import { THROTTLE_C, TRIP_C, HEAT_WEAR_MULTIPLIER_MAX, REPAIR_WEAR_RECOVERY } from './game-data';

describe('heatWearMultiplier', () => {
  it('is 1 at or below the throttle band', () => {
    expect(heatWearMultiplier(THROTTLE_C - 5)).toBe(1);
    expect(heatWearMultiplier(THROTTLE_C)).toBe(1);
  });

  it('reaches the max multiplier at or above trip temperature', () => {
    expect(heatWearMultiplier(TRIP_C)).toBe(HEAT_WEAR_MULTIPLIER_MAX);
    expect(heatWearMultiplier(TRIP_C + 20)).toBe(HEAT_WEAR_MULTIPLIER_MAX);
  });

  it('ramps linearly across the throttle band', () => {
    const mid = THROTTLE_C + (TRIP_C - THROTTLE_C) / 2;
    expect(heatWearMultiplier(mid)).toBeCloseTo(1 + (HEAT_WEAR_MULTIPLIER_MAX - 1) / 2);
  });
});

describe('wearGain', () => {
  it('scales with elapsed time and the heat multiplier', () => {
    const base = wearGain(1, 1);
    expect(wearGain(1, 2)).toBeCloseTo(base * 2);
    expect(wearGain(2, 1)).toBeCloseTo(base * 2);
  });

  it('is zero for zero elapsed time', () => {
    expect(wearGain(3, 0)).toBe(0);
  });
});

describe('failureChancePerSecond', () => {
  it('is zero for a brand-new machine', () => {
    expect(failureChancePerSecond(0)).toBe(0);
  });

  it('is monotonically increasing in wear', () => {
    const low = failureChancePerSecond(0.3);
    const high = failureChancePerSecond(0.9);
    expect(high).toBeGreaterThan(low);
  });

  it('grows steeply only near the top of the wear range (D2)', () => {
    const early = failureChancePerSecond(0.5) - failureChancePerSecond(0.4);
    const late = failureChancePerSecond(1.0) - failureChancePerSecond(0.9);
    expect(late).toBeGreaterThan(early);
  });

  it('clamps out-of-range wear instead of going negative or past the max rate', () => {
    expect(failureChancePerSecond(-1)).toBe(0);
    expect(failureChancePerSecond(5)).toBe(failureChancePerSecond(1));
  });
});

describe('rollFailure', () => {
  it('never fires when the per-second chance is zero', () => {
    expect(rollFailure(0, 100, 0)).toBe(false);
  });

  it('is deterministic against its random input: true when random is below the frame chance', () => {
    expect(rollFailure(0.5, 1, 0)).toBe(true); // chanceThisFrame = 0.5, random 0 < 0.5
    expect(rollFailure(0.5, 1, 0.99)).toBe(false);
  });

  it('a large dt (fast-forward) never pushes the effective chance above 1', () => {
    // Poisson-style compounding, not chancePerSecond * dt directly — at dt=1000 the naive
    // product would be far above 1 (and would make failure a certainty many times over). The
    // actual per-frame chance is mathematically capped at 1, so the highest possible random
    // draw can never be strictly less than it — rollFailure must stay false at that boundary.
    expect(rollFailure(0.5, 1000, 1)).toBe(false);
  });
});

describe('applyRepair', () => {
  it('reduces wear by the fixed recovery amount, never below zero', () => {
    expect(applyRepair(0.5)).toBeCloseTo(0.5 - REPAIR_WEAR_RECOVERY);
    expect(applyRepair(0.1)).toBe(0);
  });

  it('never fully resets wear to new (D6)', () => {
    expect(applyRepair(1)).toBeGreaterThan(0);
  });
});

describe('repairCost', () => {
  it('costs more to repair a more-worn machine', () => {
    const cheap = repairCost(1000, 0.1);
    const expensive = repairCost(1000, 0.9);
    expect(expensive).toBeGreaterThan(cheap);
  });

  it('scales with tier cost', () => {
    expect(repairCost(2000, 0.5)).toBeGreaterThan(repairCost(1000, 0.5));
  });
});

describe('repairSeconds', () => {
  it('takes longer to repair a more-worn machine', () => {
    expect(repairSeconds(0.9)).toBeGreaterThan(repairSeconds(0.1));
  });
});
