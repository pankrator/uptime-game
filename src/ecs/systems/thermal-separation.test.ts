// The facility's chiller budget (CoolingCapacity, a brownout cap in resource.ts) and a rack's
// temperature (thermal.ts) are separate systems that share a unit and nothing else. They used
// to share a word in the UI too, which sent an overheating player to the one upgrade that
// cannot help. These lock the separation in.
import { describe, it, expect } from 'vitest';
import { createResourceSystem } from './resource';
import { createCapacitySystem } from './capacity';
import { createThermalSystem } from './thermal';
import { buy } from './shop';
import { placeWorkload } from '../dispatch';
import { spawnRack, spawnMachine } from '../../entities';
import { createTestFacility, makeWorkload, stubEventBus } from '../test-helpers';
import { powerCapacities, coolingCapacities, temperatures, wallets } from '../components';
import { PURCHASABLES, WORKLOAD_ARCHETYPES, COOLING_UPGRADE_KW } from '../game-data';

function settledRackTemperature(coolingUpgrades: number): number {
  const { world, facility } = createTestFacility();
  const events = stubEventBus();
  world.addComponent(powerCapacities, facility, { kw: 500 });
  world.addComponent(coolingCapacities, facility, { kw: 500 });
  world.getComponent(wallets, facility)!.money = 100_000;

  const resource = createResourceSystem(world, facility, events);
  const capacity = createCapacitySystem(world, facility);
  const thermal = createThermalSystem(world, facility, events);

  const rackId = spawnRack(world, 5, 10);
  const servers = [0, 1].map((slot) => spawnMachine(world, rackId, 'dense', slot));
  const dt = 1 / 30;
  resource.update(dt);
  capacity.update(dt);

  const archetype = WORKLOAD_ARCHETYPES.render;
  for (const serverId of servers) {
    placeWorkload(
      world,
      makeWorkload(world, {
        archetypeId: 'render',
        demands: archetype.demands,
        workSeconds: 1e6,
        workRemainingSeconds: 1e6,
        deadlineRemainingSeconds: 1e6,
      }),
      serverId,
    );
    capacity.update(dt);
  }

  for (let i = 0; i < coolingUpgrades; i++) buy(world, facility, 'cooling-upgrade');

  for (let i = 0; i < 30 * 200; i++) {
    resource.update(dt);
    capacity.update(dt);
    thermal.update(dt);
  }
  return world.getComponent(temperatures, rackId)!.celsius;
}

describe('chiller budget vs rack temperature', () => {
  it('chiller capacity does not change a rack temperature by even a fraction of a degree', () => {
    expect(settledRackTemperature(10)).toBeCloseTo(settledRackTemperature(0), 6);
  });

  it('is not sold under a name that reads as rack cooling', () => {
    const chiller = PURCHASABLES.find((p) => p.id === 'cooling-upgrade')!;
    const crac = PURCHASABLES.find((p) => p.id === 'crac')!;
    expect(chiller.label).toBe(`+${COOLING_UPGRADE_KW}kW Chiller`);
    expect(chiller.category).not.toBe(crac.category);
    expect(crac.category).toBe('Rack Cooling');
  });
});
