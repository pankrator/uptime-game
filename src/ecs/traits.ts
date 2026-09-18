// Pure trait arithmetic — no ECS dependency, no side effects. Every system that touches
// traits goes through this module; no ad-hoc `a.cpu - b.cpu` anywhere else. Iterating
// TRAIT_KEYS here is what makes a future trait (e.g. bandwidth) a one-line addition instead of
// a hunt through every system. See .plans/workload-dispatch.md D5.
import { TRAIT_KEYS, type Traits, type TraitKey } from './game-data';

export function zeroTraits(): Traits {
  return TRAIT_KEYS.reduce((result, key) => ({ ...result, [key]: 0 }), {} as Traits);
}

export function addTraits(a: Traits, b: Traits): Traits {
  const result = zeroTraits();
  for (const key of TRAIT_KEYS) {
    result[key] = a[key] + b[key];
  }
  return result;
}

export function subtractTraits(a: Traits, b: Traits): Traits {
  const result = zeroTraits();
  for (const key of TRAIT_KEYS) {
    result[key] = a[key] - b[key];
  }
  return result;
}

export function scaleTraits(t: Traits, factor: number): Traits {
  const result = zeroTraits();
  for (const key of TRAIT_KEYS) {
    result[key] = Math.round(t[key] * factor);
  }
  return result;
}

export function fits(demands: Traits, free: Traits): boolean {
  return TRAIT_KEYS.every((key) => demands[key] <= free[key]);
}

// Which trait keys block placement — empty array means it fits. Used to tell the player *why*
// a drop was rejected ("needs 8 CPU, 4 free") instead of refusing silently.
export function shortfall(demands: Traits, free: Traits): TraitKey[] {
  return TRAIT_KEYS.filter((key) => demands[key] > free[key]);
}
