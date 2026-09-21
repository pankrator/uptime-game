import { describe, it, expect } from 'vitest';
import { planFixedSteps, FIXED_STEP_SECONDS, UPDATE_HZ } from './index';

describe('planFixedSteps', () => {
  it('runs one step per fire at the foreground rate', () => {
    expect(planFixedSteps(0, FIXED_STEP_SECONDS).steps).toBe(1);
  });

  it('keeps a throttled background tab at real speed', () => {
    // Browsers clamp background setInterval to roughly 1Hz. A whole second of real time must
    // advance a whole second of simulation, not one step of it.
    expect(planFixedSteps(0, 1).steps).toBe(UPDATE_HZ);
  });

  it('carries the sub-step remainder rather than losing it', () => {
    const half = FIXED_STEP_SECONDS / 2;
    const first = planFixedSteps(0, half);
    expect(first.steps).toBe(0);
    expect(planFixedSteps(first.carrySeconds, half).steps).toBe(1);
  });

  it('does not drift over many uneven fires', () => {
    let carry = 0;
    let steps = 0;
    for (let i = 0; i < 1000; i++) {
      const plan = planFixedSteps(carry, 0.017);
      carry = plan.carrySeconds;
      steps += plan.steps;
    }
    // 17 simulated seconds at UPDATE_HZ, give or take the step still in the carry.
    expect(steps).toBeGreaterThanOrEqual(Math.floor(17 * UPDATE_HZ) - 1);
    expect(steps).toBeLessThanOrEqual(Math.ceil(17 * UPDATE_HZ));
  });

  it('drops a long stall instead of replaying it', () => {
    const plan = planFixedSteps(0, 3600);
    expect(plan.steps).toBeLessThanOrEqual(UPDATE_HZ);
    expect(plan.carrySeconds).toBeLessThan(FIXED_STEP_SECONDS);
  });
});
