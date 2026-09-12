import { type World } from '../world';
import { positions, renderables, gridPositions, GRID_CELL_SIZE } from '../components';
import { type Renderer } from '../../rendering';
import { type System } from './system';

const PLAYER_RADIUS = 12;

function drawGrid(renderer: Renderer): void {
  const { width, height } = renderer.canvas;
  renderer.context.strokeStyle = '#2a2a2a';
  renderer.context.lineWidth = 1;

  for (let x = 0; x <= width; x += GRID_CELL_SIZE) {
    renderer.context.beginPath();
    renderer.context.moveTo(x, 0);
    renderer.context.lineTo(x, height);
    renderer.context.stroke();
  }

  for (let y = 0; y <= height; y += GRID_CELL_SIZE) {
    renderer.context.beginPath();
    renderer.context.moveTo(0, y);
    renderer.context.lineTo(width, y);
    renderer.context.stroke();
  }
}

export function createRenderSystem(world: World, renderer: Renderer): System {
  return {
    update() {
      drawGrid(renderer);

      for (const id of world.query(renderables, gridPositions)) {
        const renderable = world.getComponent(renderables, id)!;
        if (renderable.kind !== 'rack') continue;

        const grid = world.getComponent(gridPositions, id)!;
        renderer.context.fillStyle = '#888';
        renderer.context.fillRect(
          grid.gridX * GRID_CELL_SIZE,
          grid.gridY * GRID_CELL_SIZE,
          GRID_CELL_SIZE,
          GRID_CELL_SIZE,
        );
      }

      for (const id of world.query(renderables, positions)) {
        const renderable = world.getComponent(renderables, id)!;
        if (renderable.kind !== 'player-circle') continue;

        const position = world.getComponent(positions, id)!;
        renderer.context.fillStyle = '#4dabf7';
        renderer.context.beginPath();
        renderer.context.arc(position.x, position.y, PLAYER_RADIUS, 0, Math.PI * 2);
        renderer.context.fill();
      }
    },
  };
}
