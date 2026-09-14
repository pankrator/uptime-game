export type MachineTierId = 'basic' | 'dense';

export interface MachineTierDef {
  id: MachineTierId;
  label: string;
  cost: number;
  compute: number;
  powerKw: number;
  coolingKw: number;
  installSeconds: number;
}

export const MACHINE_TIERS: Record<MachineTierId, MachineTierDef> = {
  basic: {
    id: 'basic',
    label: 'Server',
    cost: 250,
    compute: 10,
    powerKw: 0.4,
    coolingKw: 0.3,
    installSeconds: 3.0,
  },
  dense: {
    id: 'dense',
    label: 'Blade Chassis',
    cost: 900,
    compute: 45,
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
  computeRequired: number;
  durationSeconds: number;
  payPerSecond: number;
  coolingBonusKw: number; // per assigned machine, while running
  graceSeconds: number;
  minReputation: number;
  scales: boolean; // false: computeRequired/payPerSecond stay flat, ignoring getComputeScale
}

export const WORKLOAD_ARCHETYPES: Record<WorkloadArchetypeId, WorkloadArchetypeDef> = {
  web: {
    id: 'web',
    label: 'Web Hosting',
    computeRequired: 10,
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
    computeRequired: 25,
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
    computeRequired: 45,
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
    computeRequired: 90,
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
