import { createRenderer } from './rendering';
import { createInput } from './input';
import { createGameState } from './state';
import { createGameLoop } from './core';
import { createWorld } from './ecs/world';
import { createInputSystem } from './ecs/systems/input';
import { createInstallProgressSystem } from './ecs/systems/install-progress';
import { createPathFollowSystem } from './ecs/systems/path-follow';
import { createMovementSystem } from './ecs/systems/movement';
import { createRenderSystem } from './ecs/systems/render';
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

// ORDER IS LOAD-BEARING — see .plans/machines-and-racks.md and .plans/workload-economy.md.
// install-progress runs before movement (detects arrival on last frame's position).
const systems = [
  createInputSystem(world, input, renderer, player, facility),
  createInstallProgressSystem(world, player, facility),
  createPathFollowSystem(world),
  createMovementSystem(world),
  createRenderSystem(world, renderer, player, facility),
];

const loop = createGameLoop({ renderer, input, state, systems });
state.scene = 'playing';
loop.start();
