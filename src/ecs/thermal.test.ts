import { describe, it, expect } from 'vitest';
import { coolingFalloff, targetTemperature, approachTemperature, throttleFactorFor } from './thermal';
import { AMBIENT_C, SUPPLY_AIR_C, THROTTLE_C, TRIP_C } from './game-data';

describe('coolingFalloff', () => {
  it('is full strength at zero distance', () => {
    expect(coolingFalloff(0, 3)).toBe(1);
  });

  it('falls off linearly to zero at the radius', () => {
    expect(coolingFalloff(1.5, 3)).toBeCloseTo(0.5);
    expect(coolingFalloff(3, 3)).toBe(0);
  });

  it('never goes negative past the radius', () => {
    expect(coolingFalloff(10, 3)).toBe(0);
  });

  it('is zero for a non-positive radius, never divides by zero', () => {
    expect(coolingFalloff(1, 0)).toBe(0);
  });
});

describe('targetTemperature', () => {
  it('is ambient with no heat and no cooling', () => {
    expect(targetTemperature(0, 0)).toBe(AMBIENT_C);
  });

  it('rises with heat and falls with cooling', () => {
    const hot = targetTemperature(2, 0);
    const cooled = targetTemperature(2, 2);
    expect(hot).toBeGreaterThan(AMBIENT_C);
    expect(cooled).toBeLessThan(hot);
  });

  it('never reads below the supply-air floor, however much cooling is applied', () => {
    expect(targetTemperature(0, 1000)).toBe(SUPPLY_AIR_C);
  });
});

describe('approachTemperature', () => {
  it('moves toward the target, not past it, on a normal step', () => {
    const next = approachTemperature(20, 40, 1);
    expect(next).toBeGreaterThan(20);
    expect(next).toBeLessThan(40);
  });

  it('is a no-op once already at the target', () => {
    expect(approachTemperature(30, 30, 1)).toBe(30);
  });

  it('is a no-op with zero elapsed time', () => {
    expect(approachTemperature(20, 40, 0)).toBe(20);
  });

  it('gets closer to the target with more elapsed time (thermal mass, not an instant jump)', () => {
    const soon = approachTemperature(20, 40, 0.1);
    const later = approachTemperature(20, 40, 1);
    expect(later).toBeGreaterThan(soon);
    expect(later).toBeLessThan(40);
  });
});

describe('throttleFactorFor', () => {
  it('is full speed below the throttle band', () => {
    expect(throttleFactorFor(THROTTLE_C - 1)).toBe(1);
  });

  it('is fully stalled at or above the trip temperature', () => {
    expect(throttleFactorFor(TRIP_C)).toBe(0);
    expect(throttleFactorFor(TRIP_C + 10)).toBe(0);
  });

  it('ramps linearly across the throttle band', () => {
    const mid = THROTTLE_C + (TRIP_C - THROTTLE_C) / 2;
    expect(throttleFactorFor(mid)).toBeCloseTo(0.5);
  });
});
