// Pure thermal math — no ECS dependency, no side effects. Same shape as traits.ts: every
// number thermal.ts (the system) needs is computed here first and independently testable. See
// .plans/thermal-and-cooling.md D3 and Step 2.
import {
  AMBIENT_C,
  HEAT_TO_DEGREES,
  COOLING_TO_DEGREES,
  THERMAL_RESPONSE,
  THROTTLE_C,
  TRIP_C,
} from './game-data';

// Linear falloff to zero at radiusCells, not inverse-square — legible: the player can see a
// radius ring and reason "closer is better, past the ring is nothing" (D4).
export function coolingFalloff(distanceCells: number, radiusCells: number): number {
  if (radiusCells <= 0) return 0;
  return Math.max(0, 1 - distanceCells / radiusCells);
}

// AMBIENT_C plus heat pushing it up, minus cooling pulling it down — no clamp: a rack under
// heavy cooling and no load settling below ambient is fine, there's no failure mode down there.
export function targetTemperature(heatKw: number, coolingKw: number): number {
  return AMBIENT_C + heatKw * HEAT_TO_DEGREES - coolingKw * COOLING_TO_DEGREES;
}

// Exponential approach, not an instant jump — thermal mass (D3): switching off a workload cools
// a rack over several seconds, a brief overload doesn't immediately trip it.
export function approachTemperature(currentC: number, targetC: number, dt: number): number {
  return currentC + (targetC - currentC) * THERMAL_RESPONSE * dt;
}

// 1.0 below THROTTLE_C (normal), ramping linearly to 0 at TRIP_C (D6's throttle band) — the
// system layers ThermalTrip on top once celsius actually reaches TRIP_C, so the ramp reaching
// 0 exactly there just means "no work gets paid/advanced the instant it trips," not a second
// trip condition of its own.
export function throttleFactorFor(celsius: number): number {
  if (celsius < THROTTLE_C) return 1;
  if (celsius >= TRIP_C) return 0;
  return 1 - (celsius - THROTTLE_C) / (TRIP_C - THROTTLE_C);
}
