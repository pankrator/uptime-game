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

// World is a fixed-size rect, not tied to window size (see .plans/facility-shop-inventory.md
// D2) — sized to comfortably hold the largest room tier plus the shop plus outdoor space
// between them.
export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 1600;

export const CAMERA_EDGE_PAN_MARGIN_PX = 24;
export const CAMERA_EDGE_PAN_SPEED = 700; // pixels/second while edge-panning or arrow-key panning
export const CAMERA_FOLLOW_EASE = 6; // higher = camera catches up to the player faster

// Room tier ladder — anchored at a shared top-left origin so upgrading always grows the room
// right and down (see .plans/facility-shop-inventory.md D4). Grid cells, not pixels. gridY
// leaves room above for the corridor strip (world-map.ts) that runs along the room's fixed
// top edge to the shop.
export const ROOM_ORIGIN = { gridX: 1, gridY: 6 };

export interface RoomTierDef {
  id: string;
  label: string;
  gridWidth: number;
  gridHeight: number;
  cost: number;
}

export const ROOM_TIERS: RoomTierDef[] = [
  { id: 'closet', label: 'Server Closet', gridWidth: 6, gridHeight: 5, cost: 0 },
  { id: 'small-room', label: 'Small Room', gridWidth: 10, gridHeight: 7, cost: 600 },
  { id: 'medium-room', label: 'Medium Room', gridWidth: 15, gridHeight: 10, cost: 1800 },
  { id: 'large-room', label: 'Large Room', gridWidth: 20, gridHeight: 14, cost: 4500 },
];

// Charged per second on (powerDrawKw + coolingDrawKw). See .plans/power-billing.md D6 —
// tuned so power is ~10-20% of gross revenue at healthy utilization, which is what makes a
// low-draw tier a genuine alternative to the highest-trait tier the player can afford.
export const POWER_COST_PER_KW_SECOND = 0.2;

export const POWER_UPGRADE_COST = 400;
export const POWER_UPGRADE_KW = 5;
export const COOLING_UPGRADE_COST = 350;
export const COOLING_UPGRADE_KW = 5;

// What the shop sells — unifies the three purchase kinds that used to be mixed into
// BUILDABLES (components.ts): 'stock' items go into inventory and are placed later from the
// build panel; 'instant' and 'room' apply immediately at purchase. See
// .plans/facility-shop-inventory.md D6.
export type PurchasableKind = 'stock' | 'instant' | 'room';

export type PurchasableId =
  | 'rack'
  | `machine-${MachineTierId}`
  | 'power-upgrade'
  | 'cooling-upgrade'
  | `room-${string}`;

export interface PurchasableDef {
  id: PurchasableId;
  label: string;
  kind: PurchasableKind;
  cost: number;
  category: string;
}

const machinePurchasables: PurchasableDef[] = Object.values(MACHINE_TIERS).map((tier) => ({
  id: `machine-${tier.id}` as PurchasableId,
  label: tier.label,
  kind: 'stock',
  cost: tier.cost,
  category: 'Machines',
}));

const roomPurchasables: PurchasableDef[] = ROOM_TIERS.slice(1).map((tier) => ({
  id: `room-${tier.id}` as PurchasableId,
  label: tier.label,
  kind: 'room',
  cost: tier.cost,
  category: 'Room',
}));

export const PURCHASABLES: PurchasableDef[] = [
  { id: 'rack', label: 'Rack', kind: 'stock', cost: RACK_COST, category: 'Racks' },
  ...machinePurchasables,
  { id: 'power-upgrade', label: '+5kW Power', kind: 'instant', cost: POWER_UPGRADE_COST, category: 'Utilities' },
  { id: 'cooling-upgrade', label: '+5kW Cooling', kind: 'instant', cost: COOLING_UPGRADE_COST, category: 'Utilities' },
  ...roomPurchasables,
];

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
  offerSeconds: number; // how long the OFFER sits before auto-declining (no penalty)
  // Money lost if an ACCEPTED workload's deadline passes. See .plans/contract-variety.md D1 —
  // this, not REPUTATION_ON_DECLINE, is what makes accept/decline a real bet. Scaled with
  // getComputeScale in spawnOffer for `scales: true` archetypes, exactly like payPerSecond.
  penaltyOnMiss: number;
  // [min, max] extra cycles after the first, rolled per offer in spawnOffer — see
  // .plans/contract-variety.md D2. [0, 0] means this archetype never recurs.
  repeatRange: [number, number];
}

// Each archetype leans on a different trait — that's the whole reason traits exist (see
// .plans/workload-dispatch.md): `render` is storage-heavy, `training` is RAM-hungry, `batch`
// is CPU-leaning, `web` is small and balanced. deadlineSeconds budgets workSeconds + enough
// slack to walk across the floor and dispatch (~+30s early archetypes, tightening to ~+15s
// late-game so efficient dispatch starts to matter). offerSeconds is a separate, shorter
// window purely for the accept/decline decision — it does not touch deadlineRemainingSeconds,
// which only starts counting once the offer is accepted.
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
    offerSeconds: 20,
    // payPerSecond * workSeconds * 0.5, per D1 — roughly half the gross a completed run pays.
    penaltyOnMiss: 20,
    // Small, cheap, low-stakes — the archetype most worth locking down as steady, low-attention
    // income (D2).
    repeatRange: [0, 3],
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
    offerSeconds: 18,
    penaltyOnMiss: 40,
    repeatRange: [0, 2],
  },
  render: {
    id: 'render',
    label: 'Render Farm',
    // Step 9 tuning fix: cpu/ramGb were 16/32, which fit on `dense` only — no other tier's
    // combined CPU+RAM+storage covered them, silently defeating D6's point that `storage`
    // should be a genuine, cheaper alternative for a storage-heavy workload. Trimmed to 6/20
    // (still comfortably above `budget`) so `storage` (cpu 6, ram 24) actually qualifies,
    // verified against every tier's trait triple, not just storageGb.
    demands: { cpu: 6, ramGb: 20, storageGb: 800 },
    workSeconds: 40,
    deadlineSeconds: 70,
    payPerSecond: 5.2,
    coolingBonusKw: 0.8,
    minReputation: 40,
    scales: true,
    offerSeconds: 16,
    penaltyOnMiss: 100,
    // Occasionally recurring, never more than one extra cycle — a locked storage-heavy slot
    // is expensive capacity to commit for long.
    repeatRange: [0, 1],
  },
  training: {
    id: 'training',
    label: 'ML Training',
    // Step 9 tuning fix: cpu was 24, above every tier but `dense` (whose cpu is 32; `memory`'s
    // is only 12) — same silent-`dense`-monopoly bug as render above. Trimmed to 12 so `memory`
    // (cpu 12, ram 256) qualifies, making it the intended RAM-hungry specialist choice.
    demands: { cpu: 12, ramGb: 96, storageGb: 400 },
    workSeconds: 60,
    deadlineSeconds: 85,
    payPerSecond: 11.0,
    coolingBonusKw: 2.2,
    minReputation: 60,
    scales: true,
    offerSeconds: 15,
    penaltyOnMiss: 330,
    // Highest stakes, one-shot only — a recurring training contract would lock down the
    // facility's scarcest capacity indefinitely.
    repeatRange: [0, 0],
  },
};

// Recurring offers pay less per second than a one-shot offer of the same archetype/scale — the
// player is trading rate for certainty (D2). Applied once, in spawnOffer, when a rolled
// repeatCount is nonzero.
export const RECURRING_PAY_MULTIPLIER = 0.85;

export const REPUTATION_ON_MISSED_DEADLINE = -8; // renamed from REPUTATION_ON_EXPIRY (D2)
export const REPUTATION_ON_COMPLETION = 3;
export const REPUTATION_ON_DECLINE = 0; // declining is free — see the D-note in the plan
export const MAX_OFFERS = 3; // concurrent offers on screen
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
