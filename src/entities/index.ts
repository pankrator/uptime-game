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
} from '../ecs/components';
import {
  RACK_SLOT_CAPACITY,
  STARTING_MONEY,
  STARTING_POWER_KW,
  STARTING_COOLING_KW,
  STARTING_REPUTATION,
  WORKLOAD_ARCHETYPES,
  RECURRING_PAY_MULTIPLIER,
  AMBIENT_C,
  CRAC_UNIT,
  type MachineTierId,
  type WorkloadArchetypeId,
  type PurchasableId,
} from '../ecs/game-data';
import { scaleTraits, zeroTraits } from '../ecs/traits';

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
    // D1: scaled the same way payPerSecond/demands are for `scales: true` archetypes, so
    // late-game penalties don't fall behind late-game pay.
    penaltyOnMiss: archetype.penaltyOnMiss * appliedScale,
    repeatCount,
    repeatTotal: repeatCount + 1,
  });
  return id;
}
