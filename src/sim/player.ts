// A scripted stand-in for a human player, driving the game through the same entry points the
// click chain calls: build.ts to place, maintenance.ts to install/repair, shop.ts to buy,
// dispatch.ts to accept and place work. It owns no state of its own beyond a decision timer —
// everything it decides from is read back out of the world each time.
//
// Two deliberate simplifications, both of which make a run an UPPER BOUND on the economy
// rather than a faithful transcript of one:
//   - buying does not model the walk to the shop (shop.ts's proximity gate is bypassed by
//     calling buy() directly),
//   - dispatching does not model the walk to the rack (rack-panel.ts's arrival gate is
//     bypassed by calling dispatch.ts directly).
// Placing, installing, repairing and decommissioning all go through the real walk/arrival flow,
// because maintenance.ts owns it.
import { type World, type EntityId } from '../ecs/world';
import { type System } from '../ecs/systems/system';
import {
  wallets,
  inventories,
  rackSlots,
  gridPositions,
  machines,
  installedIns,
  powereds,
  serverCapacities,
  workloads,
  offers,
  maintenanceTasks,
  conditions,
  faileds,
  temperatures,
  utilizations,
  powerCapacities,
  coolingCapacities,
  reputations,
  roomTiers,
  buildModes,
  gridToWorld,
} from '../ecs/components';
import {
  MACHINE_TIERS,
  ROOM_TIERS,
  CRAC_UNIT,
  RACK_SLOT_CAPACITY,
  WORKLOAD_ARCHETYPES,
  type MachineTierId,
  type PurchasableId,
  type Traits,
} from '../ecs/game-data';
import { getRoomRect } from '../ecs/room';
import { fits } from '../ecs/traits';
import { buy } from '../ecs/systems/shop';
import { handleBuildModePlacement } from '../ecs/systems/build';
import { startInstall, startRepair, startDecommission } from '../ecs/systems/maintenance';
import { acceptOffer, checkPlacement, placeWorkload } from '../ecs/dispatch';
import { countOf } from '../ecs/inventory';
import { headlessAudio } from './headless';
import { type Simulation } from './simulation';

/**
 * - `none` — never buys hardware. The baseline a paying strategy has to beat.
 * - `biggest-affordable` — the most CPU it can afford while keeping `cashBuffer` in hand.
 * - `unlocked-mix` — covers whichever archetype reputation has unlocked but nothing can serve.
 * - `blade-only` — saves for Blade Chassis and buys nothing else.
 */
export type BuyStrategy = 'none' | 'biggest-affordable' | 'unlocked-mix' | 'blade-only';

export interface ScriptedPlayerOptions {
  buyStrategy?: BuyStrategy;
  // Buys capacity upgrades and room tiers when the facility is close to its limits.
  buyUtilities?: boolean;
  // Buys and places CRAC units next to whichever rack is hottest.
  manageThermals?: boolean;
  // Repairs a machine once it has failed or passed this wear level. null never repairs.
  repairAboveWear?: number | null;
  // Decommissions a machine at or above this wear instead of repairing it. null never does.
  decommissionAboveWear?: number | null;
  // Caps how many machines go in one rack, the lever that decides whether a rack overheats.
  serversPerRack?: number;
  maxRacks?: number;
  // Accept an offer even when nothing currently online can hold it (the game allows it, at the
  // risk of eating penaltyOnMiss).
  acceptUnservable?: boolean;
  // Simulated seconds between decisions — a human does not re-plan every 33ms.
  decisionIntervalSeconds?: number;
  cashBuffer?: number;
}

const DEFAULTS: Required<ScriptedPlayerOptions> = {
  buyStrategy: 'biggest-affordable',
  buyUtilities: true,
  manageThermals: false,
  repairAboveWear: 0.6,
  decommissionAboveWear: null,
  serversPerRack: RACK_SLOT_CAPACITY,
  maxRacks: 8,
  acceptUnservable: false,
  decisionIntervalSeconds: 0.5,
  cashBuffer: 200,
};

const audio = headlessAudio();

function occupiedCells(world: World): Set<string> {
  const cells = new Set<string>();
  for (const id of world.query(gridPositions)) {
    const grid = world.getComponent(gridPositions, id)!;
    cells.add(`${grid.gridX},${grid.gridY}`);
  }
  return cells;
}

function racks(world: World): EntityId[] {
  return world.query(rackSlots, gridPositions);
}

function machineCount(world: World, rackId: EntityId): number {
  return world
    .query(installedIns)
    .filter((id) => world.getComponent(installedIns, id)!.rackId === rackId).length;
}

// Every other column stays empty, so the floor remains walkable and a CRAC has somewhere to go.
function freeBuildCells(world: World, facility: EntityId): { gridX: number; gridY: number }[] {
  const room = getRoomRect(world, facility);
  const occupied = occupiedCells(world);
  const cells: { gridX: number; gridY: number }[] = [];
  for (let gridY = room.minGridY; gridY <= room.maxGridY; gridY++) {
    for (let gridX = room.minGridX; gridX <= room.maxGridX; gridX++) {
      if ((gridX - room.minGridX) % 2 === 1) continue;
      if (!occupied.has(`${gridX},${gridY}`)) cells.push({ gridX, gridY });
    }
  }
  return cells;
}

function place(
  sim: Simulation,
  buildableId: 'rack' | 'crac',
  cell: { gridX: number; gridY: number },
) {
  const { world, player, facility, camera } = sim;
  world.addComponent(buildModes, player, { buildableId });
  handleBuildModePlacement(
    world,
    player,
    facility,
    camera,
    gridToWorld(cell.gridX, cell.gridY),
    audio,
  );
  world.removeComponent(buildModes, player);
}

function anyOnlineServerFits(world: World, demands: Traits): boolean {
  return world.query(machines, powereds, serverCapacities).some((id) => {
    if (!world.getComponent(powereds, id)!.online) return false;
    return fits(demands, world.getComponent(serverCapacities, id)!.free);
  });
}

function ownedTiers(world: World): Set<MachineTierId> {
  return new Set(world.query(machines).map((id) => world.getComponent(machines, id)!.tierId));
}

// Which tier to buy next, or undefined to buy nothing this decision.
function chooseTier(
  world: World,
  facility: EntityId,
  strategy: BuyStrategy,
  budget: number,
): MachineTierId | undefined {
  const affordable = Object.values(MACHINE_TIERS)
    .filter((tier) => tier.cost <= budget)
    .sort((a, b) => b.traits.cpu - a.traits.cpu);
  if (affordable.length === 0) return undefined;

  if (strategy === 'biggest-affordable') return affordable[0].id;
  if (strategy === 'blade-only') return affordable.find((tier) => tier.id === 'dense')?.id;

  // 'unlocked-mix': the cheapest tier that can serve an archetype reputation has unlocked but
  // no owned tier covers, falling back to raw capacity once every archetype is covered.
  const reputation = world.getComponent(reputations, facility)?.value ?? 0;
  const owned = ownedTiers(world);
  const uncovered = Object.values(WORKLOAD_ARCHETYPES)
    .filter((archetype) => archetype.minReputation <= reputation)
    .filter(
      (archetype) =>
        ![...owned].some((tierId) => fits(archetype.demands, MACHINE_TIERS[tierId].traits)),
    );
  for (const archetype of uncovered) {
    const cheapest = affordable
      .filter((tier) => fits(archetype.demands, tier.traits))
      .sort((a, b) => a.cost - b.cost)[0];
    if (cheapest) return cheapest.id;
  }
  return affordable[0].id;
}

/**
 * Returns a System whose update() is one player decision cycle. Run it BEFORE the simulation's
 * own tick (Simulation.run's `driver` option does exactly that), so the world advances over
 * whatever the player just did.
 */
export function createScriptedPlayer(sim: Simulation, options: ScriptedPlayerOptions = {}): System {
  const config = { ...DEFAULTS, ...options };
  const { world, facility, player } = sim;
  let sinceDecision = Infinity;

  function placeOwnedRack(): void {
    if (countOf(world, facility, 'rack') === 0) return;
    if (racks(world).length >= config.maxRacks) return;
    const cell = freeBuildCells(world, facility)[0];
    if (cell) place(sim, 'rack', cell);
  }

  function installOwnedMachine(): void {
    if (world.getComponent(maintenanceTasks, player)) return;
    const inventory = world.getComponent(inventories, facility)!;
    const tierId = (Object.keys(MACHINE_TIERS) as MachineTierId[])
      .filter((id) => (inventory.counts[`machine-${id}` as PurchasableId] ?? 0) > 0)
      .sort((a, b) => MACHINE_TIERS[b].traits.cpu - MACHINE_TIERS[a].traits.cpu)[0];
    if (!tierId) return;
    const rackId = racks(world).find((id) => machineCount(world, id) < config.serversPerRack);
    if (rackId !== undefined) startInstall(world, player, facility, tierId, rackId);
  }

  function serviceHardware(): void {
    if (world.getComponent(maintenanceTasks, player)) return;
    const candidates = world.query(machines, conditions, installedIns);

    if (config.decommissionAboveWear !== null) {
      const worn = candidates.find(
        (id) => world.getComponent(conditions, id)!.wear >= config.decommissionAboveWear!,
      );
      if (worn !== undefined) {
        startDecommission(world, player, facility, worn);
        return;
      }
    }

    if (config.repairAboveWear === null) return;
    const broken = candidates.find(
      (id) =>
        world.getComponent(faileds, id) !== undefined ||
        world.getComponent(conditions, id)!.wear > config.repairAboveWear!,
    );
    if (broken !== undefined) startRepair(world, player, facility, broken);
  }

  function buyUtilities(): void {
    const utilization = world.getComponent(utilizations, facility)!;
    const power = world.getComponent(powerCapacities, facility)!;
    const cooling = world.getComponent(coolingCapacities, facility)!;
    if (utilization.powerDrawKw > power.kw * 0.75) buy(world, facility, 'power-upgrade');
    if (utilization.coolingDrawKw > cooling.kw * 0.75) buy(world, facility, 'cooling-upgrade');

    if (freeBuildCells(world, facility).length >= 2) return;
    const tier = world.getComponent(roomTiers, facility)!;
    const next = ROOM_TIERS[tier.index + 1];
    if (next) buy(world, facility, `room-${next.id}` as PurchasableId);
  }

  function buyHardware(): void {
    if (config.buyStrategy === 'none') return;
    const wallet = world.getComponent(wallets, facility)!;
    const inventory = world.getComponent(inventories, facility)!;

    const unfilledSlots = racks(world).reduce(
      (total, id) => total + Math.max(0, config.serversPerRack - machineCount(world, id)),
      0,
    );
    const undeployed = Object.entries(inventory.counts)
      .filter(([id]) => id.startsWith('machine-'))
      .reduce((total, [, count]) => total + (count ?? 0), 0);

    if (unfilledSlots > undeployed) {
      const tierId = chooseTier(
        world,
        facility,
        config.buyStrategy,
        wallet.money - config.cashBuffer,
      );
      if (tierId) buy(world, facility, `machine-${tierId}` as PurchasableId);
      return;
    }
    if (racks(world).length < config.maxRacks) buy(world, facility, 'rack');
  }

  function manageThermals(): void {
    const wallet = world.getComponent(wallets, facility)!;
    if (countOf(world, facility, 'crac') === 0) {
      const hot = racks(world).some(
        (id) => (world.getComponent(temperatures, id)?.celsius ?? 0) > 40,
      );
      if (hot && wallet.money - CRAC_UNIT.cost > config.cashBuffer) {
        buy(world, facility, 'crac');
      }
      return;
    }

    const hottest = racks(world).sort(
      (a, b) =>
        (world.getComponent(temperatures, b)?.celsius ?? 0) -
        (world.getComponent(temperatures, a)?.celsius ?? 0),
    )[0];
    if (hottest === undefined) return;

    const grid = world.getComponent(gridPositions, hottest)!;
    const room = getRoomRect(world, facility);
    const occupied = occupiedCells(world);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const cell = { gridX: grid.gridX + dx, gridY: grid.gridY + dy };
        if (occupied.has(`${cell.gridX},${cell.gridY}`)) continue;
        if (cell.gridX < room.minGridX || cell.gridX > room.maxGridX) continue;
        if (cell.gridY < room.minGridY || cell.gridY > room.maxGridY) continue;
        place(sim, 'crac', cell);
        return;
      }
    }
  }

  function acceptOffers(): void {
    for (const offerId of world.query(offers)) {
      const offer = world.getComponent(offers, offerId)!;
      if (!config.acceptUnservable && !anyOnlineServerFits(world, offer.demands)) continue;
      acceptOffer(world, offerId);
    }
  }

  // One placement per decision: ServerCapacity.free is recomputed once per tick by capacity.ts,
  // so two placements between ticks would both validate against the same pre-placement figure.
  function dispatchOneWorkload(): void {
    const waiting = world
      .query(workloads)
      .filter((id) => world.getComponent(workloads, id)!.state === 'accepted')
      .sort((a, b) => a - b);

    for (const workloadId of waiting) {
      const target = world
        .query(machines, powereds, serverCapacities)
        .filter((serverId) => checkPlacement(world, workloadId, serverId) === null)
        .sort((a, b) => {
          const freeA = world.getComponent(serverCapacities, a)!.free;
          const freeB = world.getComponent(serverCapacities, b)!.free;
          return freeA.cpu - freeB.cpu;
        })[0];
      if (target !== undefined) {
        placeWorkload(world, workloadId, target);
        return;
      }
    }
  }

  return {
    update(deltaSeconds: number) {
      sinceDecision += deltaSeconds;
      if (sinceDecision < config.decisionIntervalSeconds) return;
      sinceDecision = 0;

      placeOwnedRack();
      installOwnedMachine();
      serviceHardware();
      if (config.buyUtilities) buyUtilities();
      if (config.manageThermals) manageThermals();
      buyHardware();
      acceptOffers();
      dispatchOneWorkload();
    },
  };
}
