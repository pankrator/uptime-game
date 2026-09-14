// Trait vector — see .plans/workload-dispatch.md D5. Named fields, not a Record<string,
// number>, so a forgotten trait in a fit-check or panel is a compile error, not a runtime bug.
export interface Traits {
  cpu: number; // cores
  ramGb: number;
  storageGb: number;
}

export const TRAIT_KEYS = ['cpu', 'ramGb', 'storageGb'] as const;
export type TraitKey = (typeof TRAIT_KEYS)[number];

export const TRAIT_LABELS: Record<TraitKey, string> = {
  cpu: 'CPU',
  ramGb: 'RAM',
  storageGb: 'SSD',
};

export const TRAIT_UNITS: Record<TraitKey, string> = {
  cpu: 'c',
  ramGb: 'GB',
  storageGb: 'GB',
};

// Step 1 of .plans/workload-dispatch.md: only `basic`/`dense` for now, converted from the old
// scalar `compute` to `traits.cpu` with a 1:1 mapping so nothing else changes behavior yet.
// Step 1a adds `storage` | `memory` | `budget`.
export type MachineTierId = 'basic' | 'dense';

export interface MachineTierDef {
  id: MachineTierId;
  label: string;
  cost: number;
  traits: Traits;
  powerKw: number;
  coolingKw: number;
  installSeconds: number;
}

export const MACHINE_TIERS: Record<MachineTierId, MachineTierDef> = {
  basic: {
    id: 'basic',
    label: 'Server',
    cost: 250,
    traits: { cpu: 10, ramGb: 999, storageGb: 999 },
    powerKw: 0.4,
    coolingKw: 0.3,
    installSeconds: 3.0,
  },
  dense: {
    id: 'dense',
    label: 'Blade Chassis',
    cost: 900,
    traits: { cpu: 45, ramGb: 999, storageGb: 999 },
    powerKw: 1.6,
    coolingKw: 1.4,
    installSeconds: 4.5,
  },
};

export const RACK_COST = 120;
export const RACK_SLOT_CAPACITY = 6;

export const POWER_UPGRADE_COST = 400;
export const POWER_UPGRADE_KW = 5;
export const COOLING_UPGRADE_COST = 350;
export const COOLING_UPGRADE_KW = 5;

export const STARTING_MONEY = 750;
export const STARTING_POWER_KW = 3;
export const STARTING_COOLING_KW = 3;
export const STARTING_REPUTATION = 50;

export type WorkloadArchetypeId = 'web' | 'batch' | 'render' | 'training';

export interface WorkloadArchetypeDef {
  id: WorkloadArchetypeId;
  label: string;
  demands: Traits;
  durationSeconds: number;
  payPerSecond: number;
  coolingBonusKw: number; // per assigned machine, while running
  graceSeconds: number;
  minReputation: number;
  scales: boolean; // false: demands/payPerSecond stay flat, ignoring getComputeScale
}

// Step 1: demands.ramGb/storageGb are set to 0 (no old scalar to map from) so they never block
// the still-CPU-only auto-assign logic in workload-assign.ts. Step 4/9 gives these real shapes.
export const WORKLOAD_ARCHETYPES: Record<WorkloadArchetypeId, WorkloadArchetypeDef> = {
  web: {
    id: 'web',
    label: 'Web Hosting',
    demands: { cpu: 10, ramGb: 0, storageGb: 0 },
    durationSeconds: 45,
    payPerSecond: 0.9,
    coolingBonusKw: 0,
    graceSeconds: 25,
    minReputation: 0,
    scales: false,
  },
  batch: {
    id: 'batch',
    label: 'Batch Job',
    demands: { cpu: 25, ramGb: 0, storageGb: 0 },
    durationSeconds: 30,
    payPerSecond: 2.6,
    coolingBonusKw: 0,
    graceSeconds: 20,
    minReputation: 20,
    scales: true,
  },
  render: {
    id: 'render',
    label: 'Render Farm',
    demands: { cpu: 45, ramGb: 0, storageGb: 0 },
    durationSeconds: 40,
    payPerSecond: 5.2,
    coolingBonusKw: 0.8,
    graceSeconds: 18,
    minReputation: 40,
    scales: true,
  },
  training: {
    id: 'training',
    label: 'ML Training',
    demands: { cpu: 90, ramGb: 0, storageGb: 0 },
    durationSeconds: 60,
    payPerSecond: 11.0,
    coolingBonusKw: 2.2,
    graceSeconds: 15,
    minReputation: 60,
    scales: true,
  },
};

export const REPUTATION_ON_EXPIRY = -8;
export const REPUTATION_ON_COMPLETION = 3;
export const BROWNOUT_COOLDOWN_SECONDS = 1.0;

export function getArrivalInterval(elapsedSeconds: number, reputation: number): number {
  return (14 - Math.min(8, elapsedSeconds / 45)) * (1.6 - (reputation / 100) * 0.8);
}

// Bounded by both a time ramp and the player's demonstrated capacity (peakComputeServed), so
// demand never outruns what an active player could plausibly serve, and a passive player's
// requirements stop growing instead of spiraling into unfillable contracts. See
// .plans/hud-and-escalation.md step 5 ("growth stays ahead of a passive player but behind an
// active one").
export function getComputeScale(elapsedSeconds: number, peakComputeServed: number): number {
  const timeScale = 1 + Math.min(2, elapsedSeconds / 300); // ramps to 3x over 10 min, then flat
  const capacityScale = Math.max(1, peakComputeServed / 30);
  return Math.min(timeScale, capacityScale);
}
