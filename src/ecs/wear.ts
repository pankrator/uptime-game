// Pure wear/failure/repair math — no ECS dependency, no side effects. Same shape as traits.ts
// and thermal.ts: every number wear.ts (the system) needs is computed here first and
// independently testable. See .plans/hardware-failure.md D1-D6 and Step 2.
import {
  WEAR_PER_SECOND,
  BASE_FAILURE_RATE,
  WEAR_FAILURE_EXPONENT,
  HEAT_WEAR_MULTIPLIER_MAX,
  REPAIR_WEAR_RECOVERY,
  REPAIR_BASE_SECONDS,
  REPAIR_COST_FRACTION,
  THROTTLE_C,
  TRIP_C,
} from './game-data';

// 1 below THROTTLE_C (no thermal shipped, or a cool rack), ramping linearly to
// HEAT_WEAR_MULTIPLIER_MAX at TRIP_C — a rack sitting in the throttle band wears meaningfully
// faster (D3), and this is the join between the thermal and hardware-failure plans.
export function heatWearMultiplier(celsius: number): number {
  if (celsius <= THROTTLE_C) return 1;
  if (celsius >= TRIP_C) return HEAT_WEAR_MULTIPLIER_MAX;
  const t = (celsius - THROTTLE_C) / (TRIP_C - THROTTLE_C);
  return 1 + t * (HEAT_WEAR_MULTIPLIER_MAX - 1);
}

// Wear gained this tick — only ever called for a machine that is online (D1: wear accrues only
// while running; an offline machine, browned out or thermally tripped, does not wear).
export function wearGain(heatMultiplier: number, dt: number): number {
  return WEAR_PER_SECOND * heatMultiplier * dt;
}

// Steep only in the top third of the wear range (WEAR_FAILURE_EXPONENT) — a new machine almost
// never fails, a neglected one probably will. Per-second rate; callers must scale by dt
// themselves (D2's warning: never roll per-tick, or the effective rate depends on UPDATE_HZ and
// the current time-control scale).
export function failureChancePerSecond(wear: number): number {
  return BASE_FAILURE_RATE * Math.pow(Math.max(0, Math.min(1, wear)), WEAR_FAILURE_EXPONENT);
}

// Whether a failure roll succeeds this tick, given the per-second chance and elapsed seconds —
// P(at least one failure in dt seconds) for a Poisson-ish per-second rate, not chancePerSecond
// * dt directly, so large dt (fast-forward) never rolls a chance above 1.
export function rollFailure(chancePerSecond: number, dt: number, random: number): boolean {
  const chanceThisFrame = 1 - Math.pow(1 - chancePerSecond, dt);
  return random < chanceThisFrame;
}

// A repair buys time, never resets to new (D6) — recovering less than full wear is what keeps
// buying replacement hardware a genuine alternative to endless cheap repairs.
export function applyRepair(wear: number): number {
  return Math.max(0, wear - REPAIR_WEAR_RECOVERY);
}

// Repair cost scales with wear so fixing a nearly-dead machine costs nearly what a new one
// does — the crossover where replacing is obviously better is the decision this mechanic
// exists to create (D6).
export function repairCost(tierCost: number, wear: number): number {
  return Math.round(tierCost * REPAIR_COST_FRACTION * (0.4 + 0.6 * wear));
}

export function repairSeconds(wear: number): number {
  return REPAIR_BASE_SECONDS * (0.5 + wear);
}
