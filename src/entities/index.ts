import { type World, type EntityId } from '../ecs/world';
import { positions, speeds, renderables, gridPositions } from '../ecs/components';

const PLAYER_SPEED = 200;

export function spawnPlayer(world: World, start: { x: number; y: number }): EntityId {
  const id = world.createEntity();
  world.addComponent(positions, id, { x: start.x, y: start.y });
  world.addComponent(speeds, id, { pixelsPerSecond: PLAYER_SPEED });
  world.addComponent(renderables, id, { kind: 'player-circle' });
  return id;
}

export function spawnRack(world: World, gridX: number, gridY: number): EntityId {
  const id = world.createEntity();
  world.addComponent(gridPositions, id, { gridX, gridY });
  world.addComponent(renderables, id, { kind: 'rack' });
  return id;
}
