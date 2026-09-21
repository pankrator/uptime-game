import { describe, it, expect } from 'vitest';
import { createWorkloadRunSystem } from './workload-run';
import { placeWorkload } from '../dispatch';
import { placedOns, reputations, temperatures, toasts, wallets, workloads } from '../components';
import { REPUTATION_ON_COMPLETION, REPUTATION_ON_MISSED_DEADLINE } from '../game-data';
import {
  createTestFacility,
  spawnOnlineServer,
  spawnRack,
  makeWorkload,
  stubEventBus,
  runTicks,
} from '../test-helpers';

describe('workload-run system', () => {
  it('pays out payPerSecond while placed on an online server', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    const workloadId = makeWorkload(world, {
      payPerSecond: 2,
      workRemainingSeconds: 100,
      deadlineRemainingSeconds: 100,
    });
    placeWorkload(world, workloadId, serverId);
    const startingMoney = world.getComponent(wallets, facility)!.money;

    runTicks(createWorkloadRunSystem(world, facility, stubEventBus()), 1, 5);

    expect(world.getComponent(wallets, facility)!.money).toBeCloseTo(startingMoney + 2 * 5);
  });

  it('does not pay out, and still burns the deadline, while sitting unplaced in the tray (D2)', () => {
    const { world, facility } = createTestFacility();
    makeWorkload(world, { payPerSecond: 2, deadlineRemainingSeconds: 100 });
    const workloadId2 = makeWorkload(world, { payPerSecond: 2, deadlineRemainingSeconds: 100 });
    const startingMoney = world.getComponent(wallets, facility)!.money;

    runTicks(createWorkloadRunSystem(world, facility, stubEventBus()), 1, 5);

    expect(world.getComponent(wallets, facility)!.money).toBe(startingMoney);
    expect(world.getComponent(workloads, workloadId2)!.deadlineRemainingSeconds).toBe(95);
  });

  it('a throttled server pays and progresses proportionally to throttleFactor, not full rate', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    world.addComponent(temperatures, rackId, { celsius: 50, throttleFactor: 0.5 });
    const workloadId = makeWorkload(world, {
      payPerSecond: 2,
      workRemainingSeconds: 100,
      deadlineRemainingSeconds: 100,
    });
    placeWorkload(world, workloadId, serverId);
    const startingMoney = world.getComponent(wallets, facility)!.money;

    runTicks(createWorkloadRunSystem(world, facility, stubEventBus()), 1, 1);

    expect(world.getComponent(wallets, facility)!.money).toBeCloseTo(startingMoney + 2 * 0.5);
    expect(world.getComponent(workloads, workloadId)!.workRemainingSeconds).toBeCloseTo(
      100 - 1 * 0.5,
    );
  });

  it('completion pays the reputation bonus and destroys a one-shot workload', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    const workloadId = makeWorkload(world, {
      workRemainingSeconds: 0.5,
      deadlineRemainingSeconds: 100,
    });
    placeWorkload(world, workloadId, serverId);
    const startingRep = world.getComponent(reputations, facility)!.value;
    const events = stubEventBus();
    const completed: number[] = [];
    events.on('contract:completed', (payload) => completed.push(payload.workloadId));

    runTicks(createWorkloadRunSystem(world, facility, events), 1, 1);

    expect(world.getComponent(reputations, facility)!.value).toBe(
      startingRep + REPUTATION_ON_COMPLETION,
    );
    expect(world.getComponent(workloads, workloadId)).toBeUndefined();
    expect(world.getComponent(placedOns, workloadId)).toBeUndefined();
    expect(completed).toEqual([workloadId]);
  });

  it('a recurring workload resets and stays placed instead of being destroyed on a non-final cycle', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    const workloadId = makeWorkload(world, {
      workSeconds: 10,
      workRemainingSeconds: 0.5,
      deadlineRemainingSeconds: 100,
      repeatCount: 1,
      repeatTotal: 2,
    });
    placeWorkload(world, workloadId, serverId);

    runTicks(createWorkloadRunSystem(world, facility, stubEventBus()), 1, 1);

    const workload = world.getComponent(workloads, workloadId);
    expect(workload).toBeDefined();
    expect(workload!.repeatCount).toBe(0);
    expect(workload!.workRemainingSeconds).toBe(10);
    expect(world.getComponent(placedOns, workloadId)).toEqual({ serverId });
  });

  it('a missed deadline applies the reputation penalty and the money penalty, then destroys the workload', () => {
    const { world, facility } = createTestFacility();
    const workloadId = makeWorkload(world, { deadlineRemainingSeconds: 0.5, penaltyOnMiss: 40 });
    const startingRep = world.getComponent(reputations, facility)!.value;
    const startingMoney = world.getComponent(wallets, facility)!.money;
    const events = stubEventBus();
    const missed: number[] = [];
    events.on('contract:missed', (payload) => missed.push(payload.workloadId));

    runTicks(createWorkloadRunSystem(world, facility, events), 1, 1);

    expect(world.getComponent(reputations, facility)!.value).toBe(
      startingRep + REPUTATION_ON_MISSED_DEADLINE,
    );
    expect(world.getComponent(wallets, facility)!.money).toBeCloseTo(startingMoney - 40);
    expect(world.getComponent(workloads, workloadId)).toBeUndefined();
    expect(missed).toEqual([workloadId]);
  });

  it('completion is checked before the deadline miss — finishing the same tick the deadline expires is a success', () => {
    const { world, facility } = createTestFacility();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    const workloadId = makeWorkload(world, {
      workRemainingSeconds: 0.5,
      deadlineRemainingSeconds: 0.5,
    });
    placeWorkload(world, workloadId, serverId);
    const startingRep = world.getComponent(reputations, facility)!.value;

    runTicks(createWorkloadRunSystem(world, facility, stubEventBus()), 1, 1);

    expect(world.getComponent(reputations, facility)!.value).toBe(
      startingRep + REPUTATION_ON_COMPLETION,
    );
  });
});

describe('missed-deadline toast', () => {
  it('rounds the penalty, which spawnOffer scales to a non-integer mid-session', () => {
    const { world, facility } = createTestFacility();
    const system = createWorkloadRunSystem(world, facility, stubEventBus());

    const workloadId = makeWorkload(world, {
      archetypeId: 'batch',
      deadlineRemainingSeconds: 0.001,
      penaltyOnMiss: 109.33333333333334,
    });
    expect(world.getComponent(workloads, workloadId)).toBeDefined();

    system.update(1 / 30);

    const text = world.query(toasts).map((id) => world.getComponent(toasts, id)!.text)[0];
    expect(text).toContain('-$109');
    expect(text).not.toMatch(/\$\d+\.\d/);
  });
});
