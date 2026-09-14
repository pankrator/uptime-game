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

// Fixed, hand-authored catalog of server tiers — no custom builds. See
// .plans/workload-dispatch.md D6. Each tier is deliberately lopsided toward a different trait
// so the catalog itself teaches that server choice is a decision: `dense` is 4x `basic`'s
// CPU/RAM but only 2x its storage; `storage` beats `dense` on disk at half the cost but a
// fifth of the CPU; `memory` has more RAM than `dense` for less money but a third of the CPU.
// `budget` is cheap and weak everywhere — an always-affordable early option, never the best
// choice for any archetype. Adding a tier later is one more row here; BUILDABLES
// (components.ts) and the build panel/hotkeys derive from MACHINE_TIERS automatically.
export type MachineTierId = 'basic' | 'dense' | 'storage' | 'memory' | 'budget';

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
  budget: {
    id: 'budget',
    label: 'Budget Box',
    cost: 120,
    traits: { cpu: 4, ramGb: 8, storageGb: 250 },
    powerKw: 0.2,
    coolingKw: 0.15,
    installSeconds: 2.0,
  },
  basic: {
    id: 'basic',
    label: 'Server',
    cost: 250,
    traits: { cpu: 8, ramGb: 32, storageGb: 1000 },
    powerKw: 0.4,
    coolingKw: 0.3,
    installSeconds: 3.0,
  },
  dense: {
    id: 'dense',
    label: 'Blade Chassis',
    cost: 900,
    traits: { cpu: 32, ramGb: 128, storageGb: 2000 },
    powerKw: 1.6,
    coolingKw: 1.4,
    installSeconds: 4.5,
  },
  storage: {
    id: 'storage',
    label: 'Storage Array',
    cost: 500,
    traits: { cpu: 6, ramGb: 24, storageGb: 6000 },
    powerKw: 0.5,
    coolingKw: 0.4,
    installSeconds: 4.0,
  },
  memory: {
    id: 'memory',
    label: 'Memory Node',
    cost: 700,
    traits: { cpu: 12, ramGb: 256, storageGb: 800 },
    powerKw: 0.9,
    coolingKw: 0.8,
    installSeconds: 4.0,
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
  workSeconds: number; // time ON a server to finish, once placed — replaces durationSeconds
  deadlineSeconds: number; // total wall-clock from acceptance — replaces graceSeconds (D2)
  payPerSecond: number;
  coolingBonusKw: number; // per assigned machine, while running
  minReputation: number;
  scales: boolean; // false: demands/payPerSecond stay flat, ignoring getComputeScale
}

// Each archetype leans on a different trait — that's the whole reason traits exist (see
// .plans/workload-dispatch.md): `render` is storage-heavy, `training` is RAM-hungry, `batch`
// is CPU-leaning, `web` is small and balanced. deadlineSeconds budgets workSeconds + enough
// slack to walk across the floor and dispatch (~+30s early archetypes, tightening to ~+15s
// late-game so efficient dispatch starts to matter).
export const WORKLOAD_ARCHETYPES: Record<WorkloadArchetypeId, WorkloadArchetypeDef> = {
  web: {
    id: 'web',
    label: 'Web Hosting',
    demands: { cpu: 2, ramGb: 8, storageGb: 100 },
    workSeconds: 45,
    deadlineSeconds: 80,
    payPerSecond: 0.9,
    coolingBonusKw: 0,
    minReputation: 0,
    scales: false,
  },
  batch: {
    id: 'batch',
    label: 'Batch Job',
    demands: { cpu: 8, ramGb: 16, storageGb: 200 },
    workSeconds: 30,
    deadlineSeconds: 60,
    payPerSecond: 2.6,
    coolingBonusKw: 0,
    minReputation: 20,
    scales: true,
  },
  render: {
    id: 'render',
    label: 'Render Farm',
    demands: { cpu: 16, ramGb: 32, storageGb: 800 },
    workSeconds: 40,
    deadlineSeconds: 70,
    payPerSecond: 5.2,
    coolingBonusKw: 0.8,
    minReputation: 40,
    scales: true,
  },
  training: {
    id: 'training',
    label: 'ML Training',
    demands: { cpu: 24, ramGb: 96, storageGb: 400 },
    workSeconds: 60,
    deadlineSeconds: 85,
    payPerSecond: 11.0,
    coolingBonusKw: 2.2,
    minReputation: 60,
    scales: true,
  },
};

export const REPUTATION_ON_MISSED_DEADLINE = -8; // renamed from REPUTATION_ON_EXPIRY (D2)
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
