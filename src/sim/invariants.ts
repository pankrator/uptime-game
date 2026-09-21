// Rules the world must satisfy after every tick, whatever the player did. Checked from the
// harness rather than asserted inside the systems, so a long run reports the first tick a rule
// broke instead of the game noticing much later — or not at all.
import { type World, type EntityId } from '../ecs/world';
import {
  placedOns,
  workloads,
  machines,
  serverCapacities,
  wallets,
  reputations,
  temperatures,
  offers,
  powereds,
  faileds,
  thermalTrips,
  installedIns,
  inventories,
  rackSlots,
  gridPositions,
  utilizations,
} from '../ecs/components';
import { TRAIT_KEYS, MAX_OFFERS, SUPPLY_AIR_C } from '../ecs/game-data';

export interface InvariantBreach {
  // Stable identifier, so a caller can de-duplicate a rule that breaks on every subsequent tick.
  rule: string;
  detail: string;
}

export function checkInvariants(world: World, facility: EntityId): InvariantBreach[] {
  const breaches: InvariantBreach[] = [];
  const report = (rule: string, detail: string) => breaches.push({ rule, detail });

  for (const workloadId of world.query(placedOns)) {
    const placement = world.getComponent(placedOns, workloadId)!;
    if (!world.getComponent(machines, placement.serverId)) {
      report(
        'placed-on-dead-server',
        `workload ${workloadId} is placed on ${placement.serverId}, which is not a machine`,
      );
    }
    const workload = world.getComponent(workloads, workloadId);
    if (!workload) report('placement-without-workload', `entity ${workloadId} has PlacedOn only`);
    else if (workload.state !== 'running') {
      report('state-desync', `workload ${workloadId} is placed but reads '${workload.state}'`);
    }
  }

  for (const workloadId of world.query(workloads)) {
    const workload = world.getComponent(workloads, workloadId)!;
    if (workload.state === 'running' && !world.getComponent(placedOns, workloadId)) {
      report('state-desync', `workload ${workloadId} reads 'running' but is not placed`);
    }
    if (
      !Number.isFinite(workload.workRemainingSeconds) ||
      !Number.isFinite(workload.deadlineRemainingSeconds)
    ) {
      report('non-finite', `workload ${workloadId} has a non-finite timer`);
    }
  }

  for (const serverId of world.query(serverCapacities)) {
    const capacity = world.getComponent(serverCapacities, serverId)!;
    for (const key of TRAIT_KEYS) {
      if (capacity.free[key] < 0) {
        report('oversubscribed', `server ${serverId} has free.${key} = ${capacity.free[key]}`);
      }
    }
  }

  const wallet = world.getComponent(wallets, facility);
  if (wallet && !Number.isFinite(wallet.money)) report('non-finite', 'wallet money');

  const reputation = world.getComponent(reputations, facility);
  if (reputation && !(reputation.value >= 0 && reputation.value <= 100)) {
    report('reputation-out-of-range', `reputation is ${reputation.value}`);
  }

  for (const rackId of world.query(temperatures)) {
    const temperature = world.getComponent(temperatures, rackId)!;
    if (!Number.isFinite(temperature.celsius)) report('non-finite', `rack ${rackId} temperature`);
    else if (temperature.celsius < SUPPLY_AIR_C - 1e-6) {
      report('below-supply-air', `rack ${rackId} reads ${temperature.celsius.toFixed(2)}C`);
    }
    if (!(temperature.throttleFactor >= 0 && temperature.throttleFactor <= 1)) {
      report('throttle-out-of-range', `rack ${rackId} throttle is ${temperature.throttleFactor}`);
    }
  }

  const offerIds = world.query(offers);
  if (offerIds.length > MAX_OFFERS) {
    report('offer-cap-exceeded', `${offerIds.length} offers are open`);
  }
  const usedSlots = new Set<number>();
  for (const offerId of offerIds) {
    const slot = world.getComponent(offers, offerId)!.slot;
    if (usedSlots.has(slot)) report('offer-slot-collision', `two offers share slot ${slot}`);
    usedSlots.add(slot);
  }

  for (const machineId of world.query(machines, powereds, installedIns)) {
    const powered = world.getComponent(powereds, machineId)!;
    const rackId = world.getComponent(installedIns, machineId)!.rackId;
    if (powered.online && world.getComponent(faileds, machineId)) {
      report('failed-but-online', `machine ${machineId}`);
    }
    if (powered.online && world.getComponent(thermalTrips, rackId)) {
      report('online-on-tripped-rack', `machine ${machineId} in rack ${rackId}`);
    }
    if (!world.getComponent(rackSlots, rackId)) {
      report('machine-without-rack', `machine ${machineId} points at rack ${rackId}`);
    }
  }

  const inventory = world.getComponent(inventories, facility);
  if (inventory) {
    for (const [id, count] of Object.entries(inventory.counts)) {
      if ((count ?? 0) < 0) report('negative-inventory', `${id} = ${count}`);
    }
  }

  const occupants = new Map<string, EntityId>();
  for (const id of world.query(gridPositions)) {
    const grid = world.getComponent(gridPositions, id)!;
    const cell = `${grid.gridX},${grid.gridY}`;
    const existing = occupants.get(cell);
    if (existing !== undefined) report('cell-collision', `${id} and ${existing} share ${cell}`);
    occupants.set(cell, id);
  }

  const utilization = world.getComponent(utilizations, facility);
  if (
    utilization &&
    (!Number.isFinite(utilization.powerDrawKw) || !Number.isFinite(utilization.revenuePerSecond))
  ) {
    report('non-finite', 'facility utilization');
  }

  return breaches;
}
