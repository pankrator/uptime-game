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
  workloads,
} from '../ecs/components';
import {
  RACK_SLOT_CAPACITY,
  STARTING_MONEY,
  STARTING_POWER_KW,
  STARTING_COOLING_KW,
  STARTING_REPUTATION,
  WORKLOAD_ARCHETYPES,
  type MachineTierId,
  type WorkloadArchetypeId,
} from '../ecs/game-data';
import { scaleTraits } from '../ecs/traits';

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

export function spawnFacility(world: World): EntityId {
  const id = world.createEntity();
  world.addComponent(wallets, id, { money: STARTING_MONEY });
  world.addComponent(reputations, id, { value: STARTING_REPUTATION });
  world.addComponent(powerCapacities, id, { kw: STARTING_POWER_KW });
  world.addComponent(coolingCapacities, id, { kw: STARTING_COOLING_KW });
  world.addComponent(utilizations, id, {
    powerDrawKw: 0,
    coolingDrawKw: 0,
    computeTotal: 0,
    computeFree: 0,
  });
  world.addComponent(demandClocks, id, {
    elapsedSeconds: 0,
    nextArrivalInSeconds: FIRST_ARRIVAL_SECONDS,
    contractsServed: 0,
    peakComputeServed: 0,
  });
  return id;
}

export function spawnWorkload(
  world: World,
  archetypeId: WorkloadArchetypeId,
  scale: number,
): EntityId {
  const archetype = WORKLOAD_ARCHETYPES[archetypeId];
  const appliedScale = archetype.scales ? scale : 1;
  const id = world.createEntity();
  world.addComponent(workloads, id, {
    archetypeId,
    demands: scaleTraits(archetype.demands, appliedScale),
    durationSeconds: archetype.durationSeconds,
    elapsedSeconds: 0,
    payPerSecond: archetype.payPerSecond * appliedScale,
    graceRemainingSeconds: archetype.graceSeconds,
    state: 'pending',
  });
  return id;
}
