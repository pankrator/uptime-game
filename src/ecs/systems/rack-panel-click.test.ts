// F7/F16: handleRackPanelClick was extracted from input.ts into a plain function taking a
// Renderer (read-only, width/height) and a point, so it can be exercised headlessly — no canvas,
// no click simulation. Only its own hit-testing/mutation is covered here; the gesture
// arbitration that decides WHEN to call it stays in input.ts, which still has no test coverage
// (see .plans/design-review.md F16).
import { describe, it, expect } from 'vitest';
import { handleRackPanelClick } from './rack-panel';
import {
  openRackPanels,
  maintenanceTasks,
  decommissionConfirms,
  conditions,
  workloads,
} from '../components';
import {
  getRackPanelCloseButtonRect,
  getServerRepairButtonRect,
  getServerDecommissionButtonRect,
  getTrayCardDropButtonRect,
} from '../../ui/layout';
import {
  createTestFacility,
  spawnOnlineServer,
  spawnRack,
  makeWorkload,
  stubAudio,
  stubRenderer,
} from '../test-helpers';

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 800;

function centerOf(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

describe('handleRackPanelClick', () => {
  it('closes the panel when the close button is clicked', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    const rackId = spawnRack(world, 0, 0);
    world.addComponent(openRackPanels, player, { rackId, mode: 'viewing', arrived: false });

    const closeRect = getRackPanelCloseButtonRect(CANVAS_WIDTH, CANVAS_HEIGHT, 0, 0);
    handleRackPanelClick(
      world,
      stubRenderer(CANVAS_WIDTH, CANVAS_HEIGHT),
      player,
      facility,
      centerOf(closeRect),
      stubAudio(),
    );

    expect(world.getComponent(openRackPanels, player)).toBeUndefined();
  });

  it('starts a repair task when the repair button is clicked on a worn server', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    world.getComponent(conditions, serverId)!.wear = 0.5;
    world.addComponent(openRackPanels, player, { rackId, mode: 'viewing', arrived: false });

    const repairRect = getServerRepairButtonRect(0, CANVAS_WIDTH, CANVAS_HEIGHT, 1, 0);
    handleRackPanelClick(
      world,
      stubRenderer(CANVAS_WIDTH, CANVAS_HEIGHT),
      player,
      facility,
      centerOf(repairRect),
      stubAudio(),
    );

    const task = world.getComponent(maintenanceTasks, player);
    expect(task?.job.kind).toBe('repair');
  });

  it('requires a second click within the confirm window before decommissioning', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    const rackId = spawnRack(world, 0, 0);
    const serverId = spawnOnlineServer(world, rackId, 'basic');
    world.addComponent(openRackPanels, player, { rackId, mode: 'viewing', arrived: false });

    const decommissionRect = getServerDecommissionButtonRect(0, CANVAS_WIDTH, CANVAS_HEIGHT, 1, 0);
    const renderer = stubRenderer(CANVAS_WIDTH, CANVAS_HEIGHT);
    const point = centerOf(decommissionRect);

    handleRackPanelClick(world, renderer, player, facility, point, stubAudio());
    expect(world.getComponent(maintenanceTasks, player)).toBeUndefined();
    expect(world.getComponent(decommissionConfirms, player)?.serverId).toBe(serverId);

    handleRackPanelClick(world, renderer, player, facility, point, stubAudio());
    const task = world.getComponent(maintenanceTasks, player);
    expect(task?.job.kind).toBe('decommission');
  });

  it('abandons a tray workload when its drop button is clicked', () => {
    const { world, facility } = createTestFacility();
    const player = world.createEntity();
    const rackId = spawnRack(world, 0, 0);
    const workloadId = makeWorkload(world, { state: 'accepted' });
    world.addComponent(openRackPanels, player, { rackId, mode: 'viewing', arrived: false });

    const dropRect = getTrayCardDropButtonRect(0, CANVAS_WIDTH, CANVAS_HEIGHT, 0, 1);
    handleRackPanelClick(
      world,
      stubRenderer(CANVAS_WIDTH, CANVAS_HEIGHT),
      player,
      facility,
      centerOf(dropRect),
      stubAudio(),
    );

    expect(world.getComponent(workloads, workloadId)).toBeUndefined();
  });
});
