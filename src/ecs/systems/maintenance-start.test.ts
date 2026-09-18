// F7/F16: startInstall/startRepair/startDecommission/cancelMaintenanceTask were extracted from
// input.ts into maintenance.ts (the module that finishes a MaintenanceTask now also starts and
// cancels one) — plain functions over World state, no canvas/input dependency, so they're
// covered directly here rather than only exercised indirectly through createMaintenanceSystem.
import { describe, it, expect } from 'vitest';
import { startInstall, startRepair, startDecommission, cancelMaintenanceTask } from './maintenance';
import { maintenanceTasks, wallets, inventories, conditions } from '../components';
import { createTestFacility, spawnOnlineServer, spawnRack } from '../test-helpers';

describe('startInstall', () => {
  it('queues an install task and takes one unit from inventory', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    const rackId = spawnRack(world, 0, 0);
    const before = world.getComponent(inventories, facility)!.counts['machine-budget'] ?? 0;

    startInstall(world, player, facility, 'budget', rackId);

    expect(world.getComponent(maintenanceTasks, player)?.job).toEqual({
      kind: 'install',
      tierId: 'budget',
      slotIndex: 0,
    });
    expect(world.getComponent(inventories, facility)!.counts['machine-budget']).toBe(before - 1);
  });

  it('does nothing when the inventory has no stock for that tier', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    const rackId = spawnRack(world, 0, 0);
    world.getComponent(inventories, facility)!.counts['machine-dense'] = 0;

    startInstall(world, player, facility, 'dense', rackId);

    expect(world.getComponent(maintenanceTasks, player)).toBeUndefined();
  });
});

describe('startRepair', () => {
  it('debits the wear-scaled cost and queues a repair task', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    world.getComponent(conditions, serverId)!.wear = 0.5;
    const wallet = world.getComponent(wallets, facility)!;
    const startingMoney = wallet.money;

    startRepair(world, player, facility, serverId);

    const task = world.getComponent(maintenanceTasks, player);
    expect(task?.job.kind).toBe('repair');
    expect(wallet.money).toBeLessThan(startingMoney);
  });

  it('does nothing when the wallet cannot afford the repair', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    world.getComponent(conditions, serverId)!.wear = 0.5;
    world.getComponent(wallets, facility)!.money = 0;

    startRepair(world, player, facility, serverId);

    expect(world.getComponent(maintenanceTasks, player)).toBeUndefined();
  });

  it('refuses a second task while one is already running', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    const rackId = spawnRack(world, 0, 0);
    const serverA = spawnOnlineServer(world, rackId, 'basic');
    const serverB = spawnOnlineServer(world, rackId, 'basic');
    world.getComponent(conditions, serverA)!.wear = 0.5;
    world.getComponent(conditions, serverB)!.wear = 0.5;

    startRepair(world, player, facility, serverA);
    const firstTask = world.getComponent(maintenanceTasks, player);
    startRepair(world, player, facility, serverB);

    expect(world.getComponent(maintenanceTasks, player)).toBe(firstTask);
  });
});

describe('startDecommission', () => {
  it('queues a decommission task with no up-front cost', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    const startingMoney = world.getComponent(wallets, facility)!.money;

    startDecommission(world, player, facility, serverId);

    expect(world.getComponent(maintenanceTasks, player)?.job).toEqual({
      kind: 'decommission',
      machineId: serverId,
    });
    expect(world.getComponent(wallets, facility)!.money).toBe(startingMoney);
  });
});

describe('cancelMaintenanceTask', () => {
  it('refunds inventory stock for a cancelled install', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    const rackId = spawnRack(world, 0, 0);
    const before = world.getComponent(inventories, facility)!.counts['machine-budget'] ?? 0;
    startInstall(world, player, facility, 'budget', rackId);

    cancelMaintenanceTask(world, facility, player);

    expect(world.getComponent(maintenanceTasks, player)).toBeUndefined();
    expect(world.getComponent(inventories, facility)!.counts['machine-budget']).toBe(before);
  });

  it('refunds the wallet for a cancelled repair', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    world.getComponent(conditions, serverId)!.wear = 0.5;
    const wallet = world.getComponent(wallets, facility)!;
    const startingMoney = wallet.money;
    startRepair(world, player, facility, serverId);

    cancelMaintenanceTask(world, facility, player);

    expect(world.getComponent(maintenanceTasks, player)).toBeUndefined();
    expect(wallet.money).toBe(startingMoney);
  });

  it('refunds nothing for a cancelled decommission', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    const wallet = world.getComponent(wallets, facility)!;
    const startingMoney = wallet.money;
    startDecommission(world, player, facility, serverId);

    cancelMaintenanceTask(world, facility, player);

    expect(world.getComponent(maintenanceTasks, player)).toBeUndefined();
    expect(wallet.money).toBe(startingMoney);
  });
});
