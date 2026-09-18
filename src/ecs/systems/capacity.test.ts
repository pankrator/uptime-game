import { describe, it, expect } from 'vitest';
import { createCapacitySystem } from './capacity';
import { placeWorkload } from '../dispatch';
import { powereds, rackLoads, serverCapacities, utilizations } from '../components';
import { MACHINE_TIERS, IDLE_POWER_FRACTION } from '../game-data';
import { createTestFacility, spawnOnlineServer, spawnRack, makeWorkload, runTicks } from '../test-helpers';

describe('capacity system', () => {
  it('reduces a server free capacity by exactly its placed workloads demands', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic'); // cpu 8, ram 32, storage 1000
    const workloadId = makeWorkload(world, { demands: { cpu: 2, ramGb: 8, storageGb: 100 } });
    placeWorkload(world, workloadId, serverId);

    runTicks(createCapacitySystem(world, facility), 1 / 30, 1);

    expect(world.getComponent(serverCapacities, serverId)).toEqual({
      total: MACHINE_TIERS.basic.traits,
      free: { cpu: 6, ramGb: 24, storageGb: 900 },
    });
  });

  it('rolls up rack power/heat/server-count from its online installed machines', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    spawnOnlineServer(world, rackId, 'basic');
    const busyServerId = spawnOnlineServer(world, rackId, 'dense');
    const workloadId = makeWorkload(world, { demands: { cpu: 1, ramGb: 1, storageGb: 1 } });
    placeWorkload(world, workloadId, busyServerId);

    runTicks(createCapacitySystem(world, facility), 1 / 30, 1);

    // idleServerId has nothing placed on it, so it draws IDLE_POWER_FRACTION of its tier's
    // power/cooling (see resource.ts's drawFor); busyServerId has a workload placed, so it
    // draws its full tier power/cooling.
    const load = world.getComponent(rackLoads, rackId)!;
    expect(load.serverCount).toBe(2);
    expect(load.powerKw).toBeCloseTo(
      MACHINE_TIERS.basic.powerKw * IDLE_POWER_FRACTION + MACHINE_TIERS.dense.powerKw,
    );
    expect(load.heatKw).toBeCloseTo(
      MACHINE_TIERS.basic.coolingKw * IDLE_POWER_FRACTION + MACHINE_TIERS.dense.coolingKw,
    );
  });

  it('an offline server reports its own total/free but contributes nothing to facility totals or rack load', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    world.getComponent(powereds, serverId)!.online = false;

    runTicks(createCapacitySystem(world, facility), 1 / 30, 1);

    expect(world.getComponent(serverCapacities, serverId)).toEqual({
      total: MACHINE_TIERS.basic.traits,
      free: MACHINE_TIERS.basic.traits,
    });
    const utilization = world.getComponent(utilizations, facility)!;
    expect(utilization.traitsTotal.cpu).toBe(0);
    const load = world.getComponent(rackLoads, rackId)!;
    expect(load.serverCount).toBe(0);
  });

  it('facility traitsTotal/traitsFree sum only online servers', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    spawnOnlineServer(world, rackId, 'basic'); // cpu 8
    const offline = spawnOnlineServer(world, rackId, 'dense'); // cpu 32
    world.getComponent(powereds, offline)!.online = false;

    runTicks(createCapacitySystem(world, facility), 1 / 30, 1);

    expect(world.getComponent(utilizations, facility)!.traitsTotal.cpu).toBe(MACHINE_TIERS.basic.traits.cpu);
  });
});
