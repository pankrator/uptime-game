// Named fields, not a Record<string, number>, so a forgotten trait in a fit-check or panel is
// a compile error, not a runtime bug.
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

// Fixed, hand-authored catalog of server tiers — no custom builds. Each tier is deliberately
// lopsided toward a different trait so the catalog itself teaches that server choice is a
// decision: `dense` is 4x `basic`'s CPU/RAM but only 2x its storage; `storage` beats `dense` on
// disk at half the cost but a fifth of the CPU; `memory` has more RAM than `dense` for less
// money but a third of the CPU. `budget` is cheap and weak everywhere — an always-affordable
// early option, never the best choice for any archetype. Adding a tier later is one more row
// here; BUILDABLES (components.ts) and the build panel/hotkeys derive from MACHINE_TIERS
// automatically.
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

// World is a fixed-size rect, not tied to window size — sized to comfortably hold the largest
// room tier plus the shop plus outdoor space between them.
export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 1600;

export const CAMERA_PAN_SPEED = 700; // pixels/second while WASD-panning
export const CAMERA_FOLLOW_EASE = 6; // higher = camera catches up to the player faster

// Pinch/ctrl+wheel zoom range — clamped so click-to-grid math and pathing stay sane at both
// extremes, and so the HUD-safe viewport can never show less floor than a rack's width at max
// zoom-in.
export const CAMERA_ZOOM_MIN = 0.6;
export const CAMERA_ZOOM_MAX = 2;

// Room tier ladder — anchored at a shared top-left origin so upgrading always grows the room
// right and down. Grid cells, not pixels. gridY leaves room above for the corridor strip
// (world-map.ts) that runs along the room's fixed top edge to the shop.
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

// Charged per second on (powerDrawKw + coolingDrawKw) — tuned so power is ~10-20% of gross
// revenue at healthy utilization, which is what makes a low-draw tier a genuine alternative to
// the highest-trait tier the player can afford.
export const POWER_COST_PER_KW_SECOND = 0.2;

export const POWER_UPGRADE_COST = 400;
export const POWER_UPGRADE_KW = 5;
// Chiller plant, NOT rack cooling — two separate systems that both used to be called "cooling"
// to the player. This one is a facility-wide BUDGET: resource.ts brownouts machines whose summed
// cooling draw exceeds it, exactly as it does for power. It has no bearing on how hot any rack
// runs; that is thermal.ts, and it comes from BASELINE_COOLING_KW plus the CRAC units placed in
// range (CRAC_UNIT below). Buying chiller capacity will never cool an overheating rack, so the
// two must not share a word anywhere the player reads.
export const COOLING_UPGRADE_COST = 350;
export const COOLING_UPGRADE_KW = 5;

// A first-order approach to a target temperature, not a fluid sim. HEAT_TO_DEGREES/
// COOLING_TO_DEGREES convert kW to the °C they push the rack's target toward; THERMAL_RESPONSE
// is the per-second fraction of the gap to target closed each tick (thermal mass — a rack does
// not jump straight to its target).
export const AMBIENT_C = 20;
// 6 °C per kW: the throttle band (THROTTLE_C…TRIP_C) is 20 °C wide, so this keeps the band
// spanning enough kW of heat (3.3 kW) that a rack doesn't snap from fine to tripped with no
// visible warning.
export const HEAT_TO_DEGREES = 6;
export const COOLING_TO_DEGREES = 6;
export const THERMAL_RESPONSE = 0.25;
export const THROTTLE_C = 45;
export const TRIP_C = 65;
// Hysteresis: a trip clears once the rack cools to this, not merely back under THROTTLE_C, or
// a rack sitting right at the boundary would flicker online/offline every tick.
export const TRIP_RECOVER_C = THROTTLE_C - 5;
// The coldest a rack can read, however much cooling reaches it — cooling cannot pull a rack
// below the air its CRACs supply. Without this floor, surplus cooling keeps subtracting
// COOLING_TO_DEGREES per kW without bound, and an over-cooled rack displays hundreds of degrees
// below zero. There is no failure mode down here, so the floor is purely about the model (and
// the number on screen) staying physical.
export const SUPPLY_AIR_C = 14;
// Building ventilation — a flat amount of cooling every rack gets for free, wherever it
// sits, so the early game needs no spatial planning. Deliberately an ABSOLUTE kW figure and NOT
// a share of the facility's CoolingCapacity: CoolingCapacity is a facility-wide budget (how much
// work the datacenter can run at once, enforced by resource.ts), while this is per rack. Scaling
// one off the other handed every rack the entire floor's cooling, so temperature fell linearly
// with rack count (~ -450 °C on a ten-rack floor) and a thermal trip became unreachable past two
// racks. Past this baseline, a rack's temperature is CRAC placement and the work it is running —
// nothing facility-wide.
export const BASELINE_COOLING_KW = 0.6;

export interface CoolingUnitDef {
  id: 'crac';
  label: string;
  cost: number;
  kwOutput: number;
  radiusCells: number;
  powerKw: number;
}

// powerKw matters: cooling costs power, so it costs money to run (POWER_COST_PER_KW_SECOND
// above) — the central tension of a real datacenter falls out for free.
export const CRAC_UNIT: CoolingUnitDef = {
  id: 'crac',
  label: 'CRAC Unit',
  cost: 450,
  kwOutput: 3,
  radiusCells: 3,
  powerKw: 0.8,
};

// What the shop sells — unifies three purchase kinds: 'stock' items go into inventory and are
// placed later from the build panel; 'instant' and 'room' apply immediately at purchase.
export type PurchasableKind = 'stock' | 'instant' | 'room';

export type PurchasableId =
  | 'rack'
  | `machine-${MachineTierId}`
  | 'crac'
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
  {
    id: 'crac',
    label: CRAC_UNIT.label,
    kind: 'stock',
    cost: CRAC_UNIT.cost,
    category: 'Rack Cooling',
  },
  {
    id: 'power-upgrade',
    label: '+5kW Power',
    kind: 'instant',
    cost: POWER_UPGRADE_COST,
    category: 'Utilities',
  },
  {
    id: 'cooling-upgrade',
    label: '+5kW Chiller',
    kind: 'instant',
    cost: COOLING_UPGRADE_COST,
    category: 'Utilities',
  },
  ...roomPurchasables,
];

export const STARTING_MONEY = 750;
export const STARTING_POWER_KW = 3;
export const STARTING_COOLING_KW = 3;
// At this reputation, `pickArchetype`'s minReputation filter (workload-spawn.ts) keeps only
// web (minReputation 0) eligible at the start — every offer in the opening minute is
// guaranteed servable on the starting hardware — and ~4 completed web contracts
// (REPUTATION_ON_COMPLETION = 3 each) unlocks batch from there.
export const STARTING_REPUTATION = 10;

export type WorkloadArchetypeId = 'web' | 'batch' | 'render' | 'training';

export interface WorkloadArchetypeDef {
  id: WorkloadArchetypeId;
  label: string;
  demands: Traits;
  workSeconds: number; // time on a server to finish, once placed
  deadlineSeconds: number; // total wall-clock time from acceptance
  payPerSecond: number;
  coolingBonusKw: number; // per assigned machine, while running
  minReputation: number;
  scales: boolean; // false: demands/payPerSecond stay flat, ignoring getValueScale/getDemandScale
  offerSeconds: number; // how long the OFFER sits before auto-declining (no penalty)
  // Money lost if an ACCEPTED workload's deadline passes — this, not REPUTATION_ON_DECLINE, is
  // what makes accept/decline a real bet. Scaled with getValueScale in spawnOffer for
  // `scales: true` archetypes, exactly like payPerSecond.
  penaltyOnMiss: number;
  // [min, max] extra cycles after the first, rolled per offer in spawnOffer. [0, 0] means this
  // archetype never recurs.
  repeatRange: [number, number];
}

// Each archetype leans on a different trait — that's the whole reason traits exist: `render`
// is storage-heavy, `training` is RAM-hungry, `batch` is CPU-leaning, `web` is small and
// balanced. deadlineSeconds budgets workSeconds + enough
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
    // payPerSecond * workSeconds * 0.5 — roughly half the gross a completed run pays.
    penaltyOnMiss: 20,
    // Small, cheap, low-stakes — the archetype most worth locking down as steady, low-attention
    // income.
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
    // cpu/ramGb chosen so `storage` (cpu 6, ram 24) qualifies as a genuine, cheaper alternative
    // to `dense` for this storage-heavy workload — verified against every tier's trait triple,
    // not just storageGb.
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
    // cpu set to 12 so `memory` (cpu 12, ram 256) qualifies, making it the intended RAM-hungry
    // specialist choice; higher would leave only `dense` able to serve it.
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

// Largest factor `demands` can be multiplied by and still fit `serverTraits` on every trait —
// the same check traits.ts's `fits` does, solved for the multiplier instead of a yes/no.
export function maxDemandScaleFor(demands: Traits, serverTraits: Traits): number {
  return Math.min(
    ...TRAIT_KEYS.map((key) => (demands[key] > 0 ? serverTraits[key] / demands[key] : Infinity)),
  );
}

// The same figure against the best tier the CATALOG offers. Computed from the catalog itself —
// not hand-typed — so a future tier or archetype change can't silently reintroduce a scaled
// offer nothing could ever serve.
function computeMaxDemandScale(demands: Traits): number {
  return Math.max(
    0,
    ...Object.values(MACHINE_TIERS).map((tier) => maxDemandScaleFor(demands, tier.traits)),
  );
}

// Precomputed once — MACHINE_TIERS and WORKLOAD_ARCHETYPES are both static. Irrelevant for
// `scales: false` archetypes (their demands never scale at all — see spawnOffer), harmless to
// compute anyway.
export const MAX_DEMAND_SCALE: Record<WorkloadArchetypeId, number> = Object.fromEntries(
  Object.values(WORKLOAD_ARCHETYPES).map((archetype) => [
    archetype.id,
    computeMaxDemandScale(archetype.demands),
  ]),
) as Record<WorkloadArchetypeId, number>;

// The DEMAND scale — how big a scaled offer's `demands` actually grow to. Bounded three ways:
//
//   - valueScale, the session's overall ramp;
//   - MAX_DEMAND_SCALE, what the best tier in the catalog could ever hold;
//   - fleetDemandScale, what the best single server the player ACTUALLY has online can hold.
//
// The fleet bound is the one that keeps growth honest. A workload occupies exactly one server,
// but valueScale climbs with facility-wide CPU, so without it a player who scaled out — nine
// Servers, say — would size every offer for hardware they don't own and couldn't serve a single
// one. Floored at 1 so a fleet of Budget Boxes still gets offers at their base size rather than
// shrinking the catalog to fit whatever is lying around: needing better hardware is the point,
// being unable to use the hardware you bought is not.
//
// Once an archetype hits any of these ceilings its size stops growing while valueScale keeps
// driving pay up — "the same job pays more," not "an unfittable job."
export function getDemandScale(
  archetypeId: WorkloadArchetypeId,
  valueScale: number,
  fleetDemandScale: number,
): number {
  return Math.min(valueScale, MAX_DEMAND_SCALE[archetypeId], Math.max(1, fleetDemandScale));
}

// Wear only accrues while a machine is online; failure is a per-second probabilistic roll
// gated by wear, steep only near the top of the range (WEAR_FAILURE_EXPONENT) so a new machine
// almost never fails. Heat multiplies wear accrual — HEAT_WEAR_MULTIPLIER_MAX is reached at
// TRIP_C, and heatWearMultiplier is 1 below THROTTLE_C either way.
export const WEAR_PER_SECOND = 0.0008; // ~20 min of continuous online runtime to fully wear
export const BASE_FAILURE_RATE = 0.0004; // per second, at wear = 0
export const WEAR_FAILURE_EXPONENT = 3; // steep only in the top third of the wear range
export const HEAT_WEAR_MULTIPLIER_MAX = 3; // reached at TRIP_C
export const REPAIR_WEAR_RECOVERY = 0.35; // a repair buys time, never resets to new
export const REPAIR_BASE_SECONDS = 4;
export const REPAIR_COST_FRACTION = 0.4; // of tier cost, scaled further by wear
export const DECOMMISSION_REFUND_FRACTION = 0.3;
export const DECOMMISSION_SECONDS = 2.0;
// Wear at/below this reads as "nothing to repair yet" — a pristine machine's repair button
// would otherwise show a nonzero cost for no benefit.
export const REPAIRABLE_WEAR_THRESHOLD = 0.02;

// Recurring offers pay less per second than a one-shot offer of the same archetype/scale — the
// player is trading rate for certainty. Applied once, in spawnOffer, when a rolled repeatCount
// is nonzero.
export const RECURRING_PAY_MULTIPLIER = 0.85;

export const REPUTATION_ON_MISSED_DEADLINE = -8;
export const REPUTATION_ON_COMPLETION = 3;
// A flat cost so pure cherry-picking (decline everything but the best offers, forever) has a
// real cost via getArrivalInterval, without making any single well-reasoned decline — e.g. a
// no-fit offer — a meaningful hit on its own. A silent EXPIRY (createOfferExpirySystem in
// workload-spawn.ts) is not this: it never calls declineOffer, so an ignored offer still costs
// nothing.
export const REPUTATION_ON_DECLINE = -1;
// Abandoning (dispatch.ts's abandonWorkload) costs more than an up-front decline — you already
// committed the capacity/attention a decline never spends — but strictly less than letting it
// rot into a miss (REPUTATION_ON_MISSED_DEADLINE, 100% of penaltyOnMiss), so cutting losses
// early is always the better move once a contract is clearly unservable.
export const ABANDON_REPUTATION_COST = -4; // between REPUTATION_ON_DECLINE and a full miss's -8
export const ABANDON_PENALTY_FRACTION = 0.5; // of penaltyOnMiss, vs. 100% on an actual miss
export const MAX_OFFERS = 3; // concurrent offers on screen
export const BROWNOUT_COOLDOWN_SECONDS = 1.0;
// resource.ts's unplaceAllOn tags each unplaced workload with the server it came from; if that
// SAME server comes back online again within this window, resource.ts re-places it there
// automatically. Generous enough to smooth over a brief power/cooling squeeze (the actual
// self-recovery path — BROWNOUT_COOLDOWN_SECONDS, or thermal's own hysteresis) without reading
// as free insurance against a real, sustained shortage.
export const BROWNOUT_RESTORE_GRACE_SECONDS = 10;
// Fires a one-shot toast (see effects.ts) the first tick draw crosses this fraction of
// capacity, before anything is actually taken offline; RESOURCE_WARNING_CLEAR_FRACTION is the
// lower hysteresis line draw must fall back under before the SAME warning can fire again, so a
// draw hovering right at the line doesn't spam a toast every tick.
export const RESOURCE_WARNING_FRACTION = 0.9;
export const RESOURCE_WARNING_CLEAR_FRACTION = 0.75;
// Buying capacity ahead of demand (the fun part of a tycoon game) shouldn't be strictly
// punished by billing idle machines at full rate. An ONLINE machine with nothing PLACED on it
// draws this fraction of its full power/cooling instead of the full amount — see resource.ts's
// drawFor (also reused by capacity.ts for the rack panel's own draw readout, so the two never
// disagree).
export const IDLE_POWER_FRACTION = 0.35;

export function clampReputation(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function getArrivalInterval(elapsedSeconds: number, reputation: number): number {
  return (14 - Math.min(8, elapsedSeconds / 45)) * (1.6 - (reputation / 100) * 0.8);
}

// Installed, ONLINE facility CPU (Utilization.traitsTotal.cpu — see capacity.ts) needed for
// getValueScale's capacityScale to reach 1 (below this, an early/passive player sees flat,
// unscaled offers) and to reach 3 (matching timeScale's own cap, at 3x this — roughly 3 Blade
// Chassis or a dozen Servers).
export const CAPACITY_SCALE_CPU_DIVISOR = 30;

// Bounded by both a time ramp and the player's demonstrated capacity (installed, online
// facility CPU — Utilization.traitsTotal.cpu), so demand never outruns what an active player
// could plausibly serve, and a passive player's requirements stop growing instead of spiraling
// into unfillable contracts.
//
// This is the VALUE scale — it drives payPerSecond/penaltyOnMiss, uncapped by what any server
// can actually hold. See getDemandScale below for the separately-capped size a scaled offer's
// demands actually grow to.
export function getValueScale(elapsedSeconds: number, facilityCpu: number): number {
  const timeScale = 1 + Math.min(2, elapsedSeconds / 300); // ramps to 3x over 10 min, then flat
  const capacityScale = Math.max(1, facilityCpu / CAPACITY_SCALE_CPU_DIVISOR);
  return Math.min(timeScale, capacityScale);
}
