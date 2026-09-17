import { describe, it, expect } from 'vitest';
import { createResourceSystem, selectMachinesToBrownOut } from './resource';
import { placeWorkload } from '../dispatch';
import { placedOns, powereds, thermalTrips, faileds, wallets, powerCapacities } from '../components';
import { BROWNOUT_COOLDOWN_SECONDS, IDLE_POWER_FRACTION, MACHINE_TIERS } from '../game-data';
import { createTestFacility, spawnOnlineServer, spawnRack, makeWorkload, stubAudio, runTicks } from '../test-helpers';

describe('selectMachinesToBrownOut (pure ordering)', () => {
  it('offlines nothing when draw is already within budget', () => {
    const online = [{ id: 1, powerKw: 1, coolingKw: 1 }];
    expect(selectMachinesToBrownOut(online, 5, 5)).toEqual(new Set());
  });

  it('offlines newest-first (highest id) until both budgets are satisfied', () => {
    const online = [
      { id: 1, powerKw: 1, coolingKw: 1 },
      { id: 2, powerKw: 1, coolingKw: 1 },
      { id: 3, powerKw: 1, coolingKw: 1 },
    ];
    // Total draw 3/3 kW against a 2/2 kW budget — only the newest needs to go.
    expect(selectMachinesToBrownOut(online, 2, 2)).toEqual(new Set([3]));
  });

  it('keeps offlining until BOTH power and cooling fit, not just the first to clear', () => {
    const online = [
      { id: 1, powerKw: 1, coolingKw: 3 },
      { id: 2, powerKw: 1, coolingKw: 3 },
    ];
    // Power (2kW) already fits a 5kW budget; cooling (6kW) does not fit a 4kW budget.
    const offline = selectMachinesToBrownOut(online, 5, 4);
    expect(offline.size).toBeGreaterThan(0);
  });
});

describe('resource system', () => {
  it('takes the newest online machine offline when draw exceeds capacity, and unplaces its workloads', () => {
    const { world, facility } = createTestFacility();
    // One dense server has a workload placed (full 1.6kW draw), the other is idle
    // (IDLE_POWER_FRACTION of that, 0.56kW) — see resource.ts's drawFor. Size capacity for
    // room for exactly the busy server's draw, not both: it fits alone but not with the idle
    // server's draw added on top, so exactly one machine must go offline.
    const busyDrawKw = MACHINE_TIERS.dense.powerKw;
    const idleDrawKw = MACHINE_TIERS.dense.powerKw * IDLE_POWER_FRACTION;
    world.getComponent(powerCapacities, facility)!.kw = busyDrawKw + idleDrawKw / 2;
    const rackId = spawnRack(world, 0, 0);
    const serverA = spawnOnlineServer(world, rackId, 'dense');
    const serverB = spawnOnlineServer(world, rackId, 'dense');
    const workloadId = makeWorkload(world);
    placeWorkload(world, workloadId, serverB);

    runTicks(createResourceSystem(world, facility, stubAudio()), 1 / 30, 1);

    const newest = serverB > serverA ? serverB : serverA;
    expect(world.getComponent(powereds, newest)!.online).toBe(false);
    expect(world.getComponent(powereds, newest)!.offlineCooldown).toBe(BROWNOUT_COOLDOWN_SECONDS);
    expect(world.getComponent(placedOns, workloadId)).toBeUndefined();
  });

  it('never brings a thermally-tripped rack back online, even with capacity to spare (D7 veto)', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'budget'); // tiny draw, plenty of budget
    world.getComponent(powereds, serverId)!.online = false;
    world.getComponent(powereds, serverId)!.offlineCooldown = 0;
    world.addComponent(thermalTrips, rackId, { trippedAt: 0 });

    runTicks(createResourceSystem(world, facility, stubAudio()), 1 / 30, 5);

    expect(world.getComponent(powereds, serverId)!.online).toBe(false);
  });

  it('never brings a failed machine back online (D7 veto), independent of a thermal trip', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'budget');
    world.getComponent(powereds, serverId)!.online = false;
    world.getComponent(powereds, serverId)!.offlineCooldown = 0;
    world.addComponent(faileds, serverId, { failedAt: 0 });

    runTicks(createResourceSystem(world, facility, stubAudio()), 1 / 30, 5);

    expect(world.getComponent(powereds, serverId)!.online).toBe(false);
  });

  it('bills the wallet for power+cooling draw at the configured rate', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    spawnOnlineServer(world, rackId, 'budget');
    const startingMoney = world.getComponent(wallets, facility)!.money;

    runTicks(createResourceSystem(world, facility, stubAudio()), 1, 1);

    expect(world.getComponent(wallets, facility)!.money).toBeLessThan(startingMoney);
  });
});
