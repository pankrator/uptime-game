import { createRenderer } from './rendering';
import { createInput } from './input';
import { createGameState } from './state';
import { createGameLoop } from './core';
import { createWorld } from './ecs/world';
import { createCamera } from './camera';
import { createInputSystem } from './ecs/systems/input';
import { createInstallProgressSystem } from './ecs/systems/install-progress';
import { createPathFollowSystem } from './ecs/systems/path-follow';
import { createMovementSystem } from './ecs/systems/movement';
import { createRackPanelSystem } from './ecs/systems/rack-panel';
import { createShopSystem } from './ecs/systems/shop';
import { createResourceSystem } from './ecs/systems/resource';
import { createCapacitySystem } from './ecs/systems/capacity';
import { createWorkloadSpawnSystem, createOfferExpirySystem } from './ecs/systems/workload-spawn';
import { createWorkloadRunSystem } from './ecs/systems/workload-run';
import { createRenderSystem } from './ecs/systems/render';
import { createHudSystem } from './ecs/systems/hud';
import { createCameraSystem } from './ecs/systems/camera';
import { spawnPlayer, spawnFacility } from './entities';
import { getRoomRect } from './ecs/room';
import { gridToWorld } from './ecs/components';
import { showLanding, hideLanding } from './landing';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) {
  throw new Error('Canvas element #game not found');
}

const landingContainer = document.querySelector<HTMLElement>('#landing');
if (!landingContainer) {
  throw new Error('Landing element #landing not found');
}

showLanding(landingContainer, () => {
  hideLanding(landingContainer);
  canvas.hidden = false;
  runGame(canvas);
});

function runGame(canvas: HTMLCanvasElement): void {
  const renderer = createRenderer(canvas);
  const input = createInput(canvas);
  const state = createGameState();
  const world = createWorld();
  const camera = createCamera(input);

  const facility = spawnFacility(world);
  const room = getRoomRect(world, facility);
  const spawnPoint = gridToWorld(
    Math.floor((room.minGridX + room.maxGridX) / 2),
    Math.floor((room.minGridY + room.maxGridY) / 2),
  );
  const player = spawnPlayer(world, spawnPoint);

  // ORDER IS LOAD-BEARING — see .plans/machines-and-racks.md, .plans/workload-economy.md, and
  // .plans/workload-dispatch.md.
  // - install-progress runs before movement (detects arrival on last frame's position).
  // - resource runs before capacity/workload-run: it computes Powered.online, which both depend
  //   on. Running workload-run first would pay out for browned-out machines and the capacity
  //   wall would be cosmetic.
  // - resource runs after movement so a machine installed this frame is budgeted the same frame.
  // - rack-panel runs after movement (arrival detection needs this frame's position) and before
  //   capacity: it commits any PendingDrop on arrival via placeWorkload, which capacity.ts must
  //   see this same frame. It's also where the player's drag-and-drop dispatch actually places
  //   workloads (step 8 of workload-dispatch.md) — there is no auto-placer anymore; a workload
  //   sits in the tray, unplaced, until the player drags it onto a server.
  // - capacity runs AFTER resource (needs Powered.online) and BEFORE workload-run: running
  //   workload-run against stale free-capacity would pay out for placements a brownout already
  //   invalidated this frame.
  // - spawn runs before run so a contract's offer window starts the same frame it arrives.
  const updateSystems = [
    createInputSystem(world, input, renderer, player, facility, camera),
    createInstallProgressSystem(world, player, facility),
    createPathFollowSystem(world),
    createMovementSystem(world),
    createRackPanelSystem(world, input, renderer, player, camera),
    createShopSystem(world, player),
    createResourceSystem(world, facility),
    createCapacitySystem(world, facility),
    createWorkloadSpawnSystem(world, facility),
    createOfferExpirySystem(world),
    createWorkloadRunSystem(world, facility),
  ];

  // Rendering runs on requestAnimationFrame, separate from the systems above: rAF pauses
  // while the tab is unfocused, but the simulation must keep advancing regardless (see
  // src/core/index.ts). Render/HUD systems only read state and draw, so they're safe to
  // pause without affecting gameplay.
  // Camera update goes first — it must update before the render systems read it this frame.
  const renderSystems = [
    createCameraSystem(world, renderer, input, player, camera),
    createRenderSystem(world, renderer, player, facility, camera, input),
    createHudSystem(world, renderer, facility),
  ];

  const loop = createGameLoop({ renderer, input, state, updateSystems, renderSystems });
  state.scene = 'playing';
  loop.start();
}
