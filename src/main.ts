import { createRenderer } from './rendering';
import { createInput } from './input';
import { createGameState } from './state';
import { createGameLoop } from './core';
import { createWorld } from './ecs/world';
import { createInputSystem } from './ecs/systems/input';
import { createInstallProgressSystem } from './ecs/systems/install-progress';
import { createPathFollowSystem } from './ecs/systems/path-follow';
import { createMovementSystem } from './ecs/systems/movement';
import { createRackPanelSystem } from './ecs/systems/rack-panel';
import { createResourceSystem } from './ecs/systems/resource';
import { createCapacitySystem } from './ecs/systems/capacity';
import { createWorkloadSpawnSystem, createOfferExpirySystem } from './ecs/systems/workload-spawn';
import { createWorkloadRunSystem } from './ecs/systems/workload-run';
import { createRenderSystem } from './ecs/systems/render';
import { createHudSystem } from './ecs/systems/hud';
import { spawnPlayer, spawnFacility } from './entities';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) {
  throw new Error('Canvas element #game not found');
}

const renderer = createRenderer(canvas);
const input = createInput(canvas);
const state = createGameState();
const world = createWorld();

const facility = spawnFacility(world);
const player = spawnPlayer(world, { x: canvas.width / 2, y: canvas.height / 2 });

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
  createInputSystem(world, input, renderer, player, facility),
  createInstallProgressSystem(world, player, facility),
  createPathFollowSystem(world),
  createMovementSystem(world),
  createRackPanelSystem(world, input, player),
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
const renderSystems = [
  createRenderSystem(world, renderer, player, facility),
  createHudSystem(world, renderer, facility),
];

const loop = createGameLoop({ renderer, input, state, updateSystems, renderSystems });
state.scene = 'playing';
loop.start();
