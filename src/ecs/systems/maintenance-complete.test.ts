// Completion behaviour of createMaintenanceSystem — what actually happens when a queued task
// finishes. Task creation is covered in maintenance-start.test.ts.
import { describe, it, expect } from 'vitest';
import { createMaintenanceSystem, startDecommission } from './maintenance';
import { placeWorkload } from '../dispatch';
import {
  positions,
  gridToWorld,
  machines,
  placedOns,
  workloads,
  maintenanceTasks,
  recentlyUnplaceds,
  wallets,
} from '../components';
import { DECOMMISSION_SECONDS, MACHINE_TIERS, DECOMMISSION_REFUND_FRACTION } from '../game-data';
import {
  createTestFacility,
  spawnOnlineServer,
  spawnRack,
  makeWorkload,
  stubEventBus,
} from '../test-helpers';

describe('decommission completion', () => {
  it('returns the workloads it was running to the tray instead of stranding them on a destroyed server', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 3, 8);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    const player = world.createEntity();
    world.addComponent(positions, player, gridToWorld(3, 8));

    const workloadId = makeWorkload(world, { demands: { cpu: 2, ramGb: 8, storageGb: 100 } });
    placeWorkload(world, workloadId, serverId);

    const system = createMaintenanceSystem(world, player, facility, stubEventBus());
    startDecommission(world, player, facility, serverId);
    for (let i = 0; i < Math.ceil(DECOMMISSION_SECONDS * 30) + 2; i++) system.update(1 / 30);

    expect(world.getComponent(maintenanceTasks, player)).toBeUndefined();
    expect(world.getComponent(machines, serverId)).toBeUndefined();
    expect(world.getComponent(placedOns, workloadId)).toBeUndefined();
    expect(world.getComponent(workloads, workloadId)!.state).toBe('accepted');
  });

  it('does not tag the returned workloads for auto-restore — that server is gone for good', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 3, 8);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    const player = world.createEntity();
    world.addComponent(positions, player, gridToWorld(3, 8));

    const workloadId = makeWorkload(world, { demands: { cpu: 2, ramGb: 8, storageGb: 100 } });
    placeWorkload(world, workloadId, serverId);

    const system = createMaintenanceSystem(world, player, facility, stubEventBus());
    startDecommission(world, player, facility, serverId);
    for (let i = 0; i < Math.ceil(DECOMMISSION_SECONDS * 30) + 2; i++) system.update(1 / 30);

    expect(world.getComponent(recentlyUnplaceds, workloadId)).toBeUndefined();
  });

  it('still pays the refund', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 3, 8);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    const player = world.createEntity();
    world.addComponent(positions, player, gridToWorld(3, 8));
    const before = world.getComponent(wallets, facility)!.money;

    const system = createMaintenanceSystem(world, player, facility, stubEventBus());
    startDecommission(world, player, facility, serverId);
    for (let i = 0; i < Math.ceil(DECOMMISSION_SECONDS * 30) + 2; i++) system.update(1 / 30);

    expect(world.getComponent(wallets, facility)!.money).toBe(
      before + Math.round(MACHINE_TIERS.basic.cost * DECOMMISSION_REFUND_FRACTION),
    );
  });
});
