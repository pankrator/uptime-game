import { type World, type EntityId } from '../ecs/world';
import {
  positions,
  speeds,
  renderables,
  gridPositions,
  rackSlots,
  machines,
  installedIns,
  powereds,
  wallets,
  reputations,
  powerCapacities,
  coolingCapacities,
  utilizations,
  demandClocks,
  offers,
  roomTiers,
  inventories,
  temperatures,
  coolingUnits,
  conditions,
} from '../ecs/components';
import {
  RACK_SLOT_CAPACITY,
  STARTING_MONEY,
  STARTING_POWER_KW,
  STARTING_COOLING_KW,
  STARTING_REPUTATION,
  WORKLOAD_ARCHETYPES,
  MAX_OFFERS,
  RECURRING_PAY_MULTIPLIER,
  AMBIENT_C,
  CRAC_UNIT,
  type MachineTierId,
  type WorkloadArchetypeId,
  type PurchasableId,
} from '../ecs/game-data';
import { scaleTraits, zeroTraits } from '../ecs/traits';
import { acceptOffer, placeWorkload } from '../ecs/dispatch';

const FIRST_ARRIVAL_SECONDS = 15;

const PLAYER_SPEED = 200;

export function spawnPlayer(world: World, start: { x: number; y: number }): EntityId {
  const id = world.createEntity();
  world.addComponent(positions, id, { x: start.x, y: start.y });
  world.addComponent(speeds, id, { pixelsPerSecond: PLAYER_SPEED });
  world.addComponent(renderables, id, { kind: 'player-circle' });
  return id;
}

export function spawnRack(world: World, gridX: number, gridY: number): EntityId {
  const id = world.createEntity();
  world.addComponent(gridPositions, id, { gridX, gridY });
  world.addComponent(renderables, id, { kind: 'rack' });
  world.addComponent(rackSlots, id, { capacity: RACK_SLOT_CAPACITY });
  // See .plans/thermal-and-cooling.md D1/D2: starts at ambient, then owned solely by thermal.ts.
  world.addComponent(temperatures, id, { celsius: AMBIENT_C, throttleFactor: 1 });
  return id;
}

// A placed CRAC unit — mirrors spawnRack. See .plans/thermal-and-cooling.md D4/Step 6.
export function spawnCoolingUnit(world: World, gridX: number, gridY: number): EntityId {
  const id = world.createEntity();
  world.addComponent(gridPositions, id, { gridX, gridY });
  world.addComponent(renderables, id, { kind: 'crac' });
  world.addComponent(coolingUnits, id, {
    kwOutput: CRAC_UNIT.kwOutput,
    radiusCells: CRAC_UNIT.radiusCells,
  });
  return id;
}

export function spawnMachine(
  world: World,
  rackId: EntityId,
  tierId: MachineTierId,
  slotIndex: number,
): EntityId {
  const id = world.createEntity();
  world.addComponent(machines, id, { tierId });
  world.addComponent(installedIns, id, { rackId, slotIndex });
  world.addComponent(powereds, id, { online: false, offlineCooldown: 0 });
  // See .plans/hardware-failure.md D1: starts new, then owned solely by wear.ts.
  world.addComponent(conditions, id, { wear: 0 });
  return id;
}

// Starting stock — lets the game be playable before the shop exists (step 4) and becomes the
// real starting state once it does (step 5): a rack and one budget box to get going, so a
// fresh game isn't a walk to the shop before anything can happen.
const STARTING_INVENTORY: Partial<Record<PurchasableId, number>> = {
  rack: 1,
  'machine-budget': 2,
};

export function spawnFacility(world: World): EntityId {
  const id = world.createEntity();
  world.addComponent(roomTiers, id, { index: 0 });
  world.addComponent(inventories, id, { counts: { ...STARTING_INVENTORY } });
  world.addComponent(wallets, id, { money: STARTING_MONEY });
  world.addComponent(reputations, id, { value: STARTING_REPUTATION });
  world.addComponent(powerCapacities, id, { kw: STARTING_POWER_KW });
  world.addComponent(coolingCapacities, id, { kw: STARTING_COOLING_KW });
  world.addComponent(utilizations, id, {
    powerDrawKw: 0,
    coolingDrawKw: 0,
    computeTotal: 0,
    computeFree: 0,
    traitsTotal: zeroTraits(),
    traitsFree: zeroTraits(),
    powerCostPerSecond: 0,
    revenuePerSecond: 0,
  });
  world.addComponent(demandClocks, id, {
    elapsedSeconds: 0,
    nextArrivalInSeconds: FIRST_ARRIVAL_SECONDS,
    contractsServed: 0,
    peakComputeServed: 0,
  });
  return id;
}

// Lowest offers-panel slot (0..MAX_OFFERS-1) not currently held by a live offer — see Offer.slot
// in components.ts. The spawn system never calls this while at MAX_OFFERS concurrent offers
// (workload-spawn.ts checks the cap first), so a free slot always exists here.
function lowestFreeOfferSlot(world: World): number {
  const used = new Set<number>();
  for (const id of world.query(offers)) {
    used.add(world.getComponent(offers, id)!.slot);
  }
  for (let slot = 0; slot < MAX_OFFERS; slot++) {
    if (!used.has(slot)) return slot;
  }
  return 0; // unreachable given the caller's cap check; a safe fallback rather than a throw
}

// Spawns an Offer awaiting accept/decline — NOT a live Workload. Accepting (dispatch.ts's
// acceptOffer) is what turns an offer into a Workload entity; see .plans/workload-dispatch.md
// step 5.
export function spawnOffer(world: World, archetypeId: WorkloadArchetypeId, scale: number): EntityId {
  const archetype = WORKLOAD_ARCHETYPES[archetypeId];
  const appliedScale = archetype.scales ? scale : 1;

  // D2: roll how many extra cycles this offer commits to, then apply the recurring pay
  // discount (D2's "trading rate for certainty") only when it actually recurs.
  const [minRepeat, maxRepeat] = archetype.repeatRange;
  const repeatCount = minRepeat + Math.floor(Math.random() * (maxRepeat - minRepeat + 1));
  const payMultiplier = repeatCount > 0 ? RECURRING_PAY_MULTIPLIER : 1;

  const id = world.createEntity();
  world.addComponent(offers, id, {
    archetypeId,
    demands: scaleTraits(archetype.demands, appliedScale),
    workSeconds: archetype.workSeconds,
    deadlineSeconds: archetype.deadlineSeconds,
    payPerSecond: archetype.payPerSecond * appliedScale * payMultiplier,
    secondsRemaining: archetype.offerSeconds,
    slot: lowestFreeOfferSlot(world),
    // D1: scaled the same way payPerSecond/demands are for `scales: true` archetypes, so
    // late-game penalties don't fall behind late-game pay.
    penaltyOnMiss: archetype.penaltyOnMiss * appliedScale,
    repeatCount,
    repeatTotal: repeatCount + 1,
  });
  return id;
}

// Dev-only shortcut (see landing/index.ts's DEV-gated "big setup" button) for testing a
// built-out facility without grinding to it — built entirely from the same spawn/dispatch
// helpers a real playthrough hits, just compressed into one call, so it can't drift from the
// real economy rules (costs, capacity, fit checks).
const STRESS_ROOM_TIER_INDEX = 2; // ROOM_TIERS[2] = 'medium-room' (15x10)
const STRESS_MONEY = 12000;
const STRESS_POWER_KW = 40;
const STRESS_COOLING_KW = 40;

// Two rows of racks with an aisle between and around them, inside medium-room's bounds
// (ROOM_ORIGIN.gridX=1..15, gridY=6..15 — see room.ts/game-data.ts).
const STRESS_RACK_POSITIONS: { gridX: number; gridY: number }[] = [
  { gridX: 3, gridY: 8 },
  { gridX: 6, gridY: 8 },
  { gridX: 9, gridY: 8 },
  { gridX: 12, gridY: 8 },
  { gridX: 3, gridY: 12 },
  { gridX: 6, gridY: 12 },
  { gridX: 9, gridY: 12 },
  { gridX: 12, gridY: 12 },
];

const STRESS_MACHINE_TIERS: MachineTierId[] = ['basic', 'dense', 'storage', 'memory'];
const STRESS_MACHINES_PER_RACK = 3;

// archetype -> tier pairing chosen so each contract comfortably fits the server it's placed on
// (see MACHINE_TIERS/WORKLOAD_ARCHETYPES in game-data.ts) without needing a fit check here.
const STRESS_RUNNING_CONTRACTS: { archetypeId: WorkloadArchetypeId; tierId: MachineTierId }[] = [
  { archetypeId: 'web', tierId: 'basic' },
  { archetypeId: 'batch', tierId: 'dense' },
  { archetypeId: 'render', tierId: 'storage' },
  { archetypeId: 'training', tierId: 'memory' },
];

const STRESS_PENDING_OFFERS: WorkloadArchetypeId[] = ['web', 'batch'];

export function applyStressPreset(world: World, facility: EntityId): void {
  world.addComponent(roomTiers, facility, { index: STRESS_ROOM_TIER_INDEX });
  world.addComponent(wallets, facility, { money: STRESS_MONEY });
  world.addComponent(powerCapacities, facility, { kw: STRESS_POWER_KW });
  world.addComponent(coolingCapacities, facility, { kw: STRESS_COOLING_KW });

  const firstMachineByTier = new Map<MachineTierId, EntityId>();
  STRESS_RACK_POSITIONS.forEach(({ gridX, gridY }, rackIndex) => {
    const rackId = spawnRack(world, gridX, gridY);
    for (let slotIndex = 0; slotIndex < STRESS_MACHINES_PER_RACK; slotIndex++) {
      const tierId =
        STRESS_MACHINE_TIERS[(rackIndex * STRESS_MACHINES_PER_RACK + slotIndex) % STRESS_MACHINE_TIERS.length];
      const machineId = spawnMachine(world, rackId, tierId, slotIndex);
      if (!firstMachineByTier.has(tierId)) firstMachineByTier.set(tierId, machineId);
    }
  });

  for (const { archetypeId, tierId } of STRESS_RUNNING_CONTRACTS) {
    const serverId = firstMachineByTier.get(tierId);
    if (!serverId) continue;
    const offerId = spawnOffer(world, archetypeId, 1);
    const workloadId = acceptOffer(world, offerId);
    placeWorkload(world, workloadId, serverId);
  }

  for (const archetypeId of STRESS_PENDING_OFFERS) {
    spawnOffer(world, archetypeId, 1);
  }
}
