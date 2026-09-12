import { createRenderer } from './rendering';
import { createInput } from './input';
import { createGameState } from './state';
import { createGameLoop } from './core';
import { createWorld } from './ecs/world';
import { createInputSystem } from './ecs/systems/input';
import { createMovementSystem } from './ecs/systems/movement';
import { createRenderSystem } from './ecs/systems/render';
import { spawnPlayer } from './entities';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) {
  throw new Error('Canvas element #game not found');
}

const renderer = createRenderer(canvas);
const input = createInput(canvas);
const state = createGameState();
const world = createWorld();

const player = spawnPlayer(world, { x: canvas.width / 2, y: canvas.height / 2 });

const systems = [
  createInputSystem(world, input, player),
  createMovementSystem(world),
  createRenderSystem(world, renderer),
];

const loop = createGameLoop({ renderer, input, state, systems });
state.scene = 'playing';
loop.start();
