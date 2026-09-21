// A flat, printable reading of the facility — what a check-up looks at when it asks "how did
// this run go". Pure derivation from the world, no mutation.
import {
  wallets,
  reputations,
  demandClocks,
  utilizations,
  machines,
  rackSlots,
  workloads,
  placedOns,
  offers,
  temperatures,
  conditions,
  thermalTrips,
  faileds,
} from '../ecs/components';
import { MACHINE_TIERS, type MachineTierId } from '../ecs/game-data';
import { type Simulation } from './simulation';

export interface SimulationSnapshot {
  elapsedSeconds: number;
  money: number;
  reputation: number;
  contractsServed: number;
  racks: number;
  servers: number;
  // Servers by tier, for reading what the player actually built.
  serversByTier: Partial<Record<MachineTierId, number>>;
  runningWorkloads: number;
  trayWorkloads: number;
  openOffers: number;
  facilityCpu: number;
  powerDrawKw: number;
  revenuePerSecond: number;
  powerCostPerSecond: number;
  hottestRackCelsius: number;
  trippedRacks: number;
  failedMachines: number;
  worstWear: number;
}

export function snapshot(sim: Simulation): SimulationSnapshot {
  const { world, facility } = sim;
  const utilization = world.getComponent(utilizations, facility);
  const clock = world.getComponent(demandClocks, facility);

  const serversByTier: Partial<Record<MachineTierId, number>> = {};
  for (const id of world.query(machines)) {
    const tierId = world.getComponent(machines, id)!.tierId;
    serversByTier[tierId] = (serversByTier[tierId] ?? 0) + 1;
  }

  const workloadIds = world.query(workloads);
  const temperatureValues = world
    .query(temperatures)
    .map((id) => world.getComponent(temperatures, id)!.celsius);
  const wearValues = world.query(conditions).map((id) => world.getComponent(conditions, id)!.wear);

  return {
    elapsedSeconds: sim.elapsedSeconds,
    money: world.getComponent(wallets, facility)?.money ?? 0,
    reputation: world.getComponent(reputations, facility)?.value ?? 0,
    contractsServed: clock?.contractsServed ?? 0,
    racks: world.query(rackSlots).length,
    servers: world.query(machines).length,
    serversByTier,
    runningWorkloads: world.query(placedOns).length,
    trayWorkloads: workloadIds.filter(
      (id) => world.getComponent(workloads, id)!.state === 'accepted',
    ).length,
    openOffers: world.query(offers).length,
    facilityCpu: utilization?.traitsTotal.cpu ?? 0,
    powerDrawKw: utilization?.powerDrawKw ?? 0,
    revenuePerSecond: utilization?.revenuePerSecond ?? 0,
    powerCostPerSecond: utilization?.powerCostPerSecond ?? 0,
    hottestRackCelsius: temperatureValues.length > 0 ? Math.max(...temperatureValues) : 0,
    trippedRacks: world.query(thermalTrips).length,
    failedMachines: world.query(faileds).length,
    worstWear: wearValues.length > 0 ? Math.max(...wearValues) : 0,
  };
}

// One fixed-width line per snapshot, so a sequence of them reads as a timeline in test output.
export function formatSnapshot(value: SimulationSnapshot): string {
  const tiers = Object.entries(value.serversByTier)
    .map(([tierId, count]) => `${MACHINE_TIERS[tierId as MachineTierId].label}x${count}`)
    .join(' ');
  return [
    `${Math.round(value.elapsedSeconds / 60)}m`.padStart(4),
    `$${Math.round(value.money)}`.padStart(9),
    `${Math.round(value.reputation)}★`.padStart(5),
    `served ${value.contractsServed}`.padStart(11),
    `${value.racks}r/${value.servers}s`.padStart(8),
    `cpu ${value.facilityCpu}`.padStart(9),
    `run ${value.runningWorkloads}`.padStart(7),
    `+${value.revenuePerSecond.toFixed(2)}/s`.padStart(10),
    `-${value.powerCostPerSecond.toFixed(2)}/s`.padStart(9),
    `${Math.round(value.hottestRackCelsius)}C`.padStart(5),
    `wear ${value.worstWear.toFixed(2)}`.padStart(10),
    tiers,
  ].join(' ');
}
