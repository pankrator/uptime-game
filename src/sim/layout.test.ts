// Floor-plan balance: heat is meant to be a question about where things go, which only holds
// while interleaving cooling with racks competes with simply spreading the hardware out. Racks
// are cheap and CRAC units are not, so this is the relationship RACK_COST is priced against —
// it is the first thing a tuning change to either will break.
import { describe, it, expect } from 'vitest';
import { createWorld } from '../ecs/world';
import { spawnFacility, spawnRack, spawnMachine, spawnCoolingUnit } from '../entities';
import { createResourceSystem } from '../ecs/systems/resource';
import { createCapacitySystem } from '../ecs/systems/capacity';
import { createThermalSystem } from '../ecs/systems/thermal';
import { placeWorkload } from '../ecs/dispatch';
import { makeWorkload, stubEventBus } from '../ecs/test-helpers';
import { powerCapacities, coolingCapacities, temperatures, machines } from '../ecs/components';
import { WORKLOAD_ARCHETYPES, MACHINE_TIERS, RACK_COST, CRAC_UNIT } from '../ecs/game-data';
import { SIMULATION_TICK_SECONDS } from './simulation';

interface Layout {
  rackCells: [number, number][];
  cracCells: [number, number][];
  machinesPerRack: number;
}

function settle(layout: Layout) {
  const world = createWorld();
  const facility = spawnFacility(world);
  const events = stubEventBus();
  world.addComponent(powerCapacities, facility, { kw: 2000 });
  world.addComponent(coolingCapacities, facility, { kw: 2000 });

  const resource = createResourceSystem(world, facility, events);
  const capacity = createCapacitySystem(world, facility);
  const thermal = createThermalSystem(world, facility, events);

  const rackIds = layout.rackCells.map(([gridX, gridY]) => spawnRack(world, gridX, gridY));
  for (const [gridX, gridY] of layout.cracCells) spawnCoolingUnit(world, gridX, gridY);
  for (const rackId of rackIds) {
    for (let slot = 0; slot < layout.machinesPerRack; slot++) {
      spawnMachine(world, rackId, 'dense', slot);
    }
  }

  const dt = SIMULATION_TICK_SECONDS;
  resource.update(dt);
  capacity.update(dt);

  const archetype = WORKLOAD_ARCHETYPES.render;
  for (const machineId of world.query(machines)) {
    placeWorkload(
      world,
      makeWorkload(world, {
        archetypeId: 'render',
        demands: archetype.demands,
        workSeconds: 1e6,
        workRemainingSeconds: 1e6,
        deadlineRemainingSeconds: 1e6,
      }),
      machineId,
    );
    capacity.update(dt);
  }
  for (let i = 0; i < 30 * 240; i++) {
    resource.update(dt);
    capacity.update(dt);
    thermal.update(dt);
  }

  const boxes = rackIds.length * layout.machinesPerRack;
  const throttle =
    rackIds.reduce((sum, id) => sum + world.getComponent(temperatures, id)!.throttleFactor, 0) /
    rackIds.length;
  return {
    throttle,
    boxes,
    cells: rackIds.length + layout.cracCells.length,
    capex:
      rackIds.length * RACK_COST +
      layout.cracCells.length * CRAC_UNIT.cost +
      boxes * MACHINE_TIERS.dense.cost,
  };
}

// Twelve Blade Chassis on Render Farm, two ways. Both run every box at full speed; the question
// is what each costs in money and in floor.
const SPREAD_THIN: Layout = {
  rackCells: [
    [2, 8],
    [4, 8],
    [6, 8],
    [2, 12],
    [4, 12],
    [6, 12],
  ],
  cracCells: [],
  machinesPerRack: 2,
};

// Four racks packed around one shared CRAC, which reaches all of them.
const SHARED_COOLING: Layout = {
  rackCells: [
    [2, 9],
    [4, 9],
    [3, 8],
    [3, 10],
  ],
  cracCells: [[3, 9]],
  machinesPerRack: 3,
};

describe('floor-plan strategies', () => {
  it('both reach full speed, so the choice is about cost rather than throughput', () => {
    expect(settle(SPREAD_THIN).throttle).toBeCloseTo(1, 2);
    expect(settle(SHARED_COOLING).throttle).toBeCloseTo(1, 2);
  });

  it('sharing one CRAC between racks is not dominated by spreading out', () => {
    const spread = settle(SPREAD_THIN);
    const shared = settle(SHARED_COOLING);
    expect(shared.boxes).toBe(spread.boxes);

    // If spreading were cheaper on both axes at once, nobody would ever place a CRAC.
    expect(shared.cells).toBeLessThan(spread.cells);
    expect(shared.capex).toBeLessThanOrEqual(spread.capex);
  });

  it('a rack costs enough that splitting the load is a real decision', () => {
    // Two racks' worth of splitting has to be comparable to a CRAC, or heat stops being a
    // floor-plan question and becomes "buy another rack" every time.
    expect(RACK_COST * 2).toBeGreaterThan(CRAC_UNIT.cost);
  });
});
