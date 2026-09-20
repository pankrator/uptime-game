// Build mode: the build panel entry toggle and placing a buildable into the world. Extracted
// from input.ts's click router (.plans/input-router-refactor.md D3) — input.ts decides WHEN a
// click reaches these, not WHAT they do, same split as rack-panel.ts's handleRackPanelClick /
// shop.ts's handleShopClick. No System of its own: build mode has no per-frame behavior beyond
// reacting to a click/key, same as offers/jobs' click handlers.
import { type World, type EntityId } from '../world';
import {
  gridPositions,
  worldToGrid,
  buildModes,
  BUILDABLES,
  type BuildableDef,
} from '../components';
import { type MachineTierId, type PurchasableId } from '../game-data';
import { getRoomRect } from '../room';
import { takeFromInventory } from '../inventory';
import { startInstall } from './maintenance';
import { findRackAt } from './rack-panel';
import { spawnRack, spawnCoolingUnit } from '../../entities';
import { type Camera } from '../../camera';
import { type Audio } from '../../audio';
import { getBuildPanelEntryRect, pointerInRect } from '../../ui/layout';

export function selectBuildable(world: World, controlled: EntityId, selected: BuildableDef): void {
  const buildMode = world.getComponent(buildModes, controlled);
  if (buildMode?.buildableId === selected.id) {
    world.removeComponent(buildModes, controlled);
  } else {
    world.addComponent(buildModes, controlled, { buildableId: selected.id });
  }
}

export function hitTestBuildPanel(
  point: { x: number; y: number },
  canvasHeight: number,
): number | null {
  for (let index = 0; index < BUILDABLES.length; index++) {
    const rect = getBuildPanelEntryRect(index, canvasHeight);
    if (pointerInRect(point, rect)) {
      return index;
    }
  }
  return null;
}

// Returns true if the click landed on a build panel entry (and was handled) — input.ts's router
// uses this to decide whether the click falls through to the next branch (build-mode placement).
export function handleBuildPanelClick(
  world: World,
  controlled: EntityId,
  pointer: { x: number; y: number },
  canvasHeight: number,
): boolean {
  const panelIndex = hitTestBuildPanel(pointer, canvasHeight);
  if (panelIndex === null) return false;
  selectBuildable(world, controlled, BUILDABLES[panelIndex]);
  return true;
}

function isGridCellOccupied(world: World, gridX: number, gridY: number): boolean {
  return world.query(gridPositions).some((id) => {
    const grid = world.getComponent(gridPositions, id)!;
    return grid.gridX === gridX && grid.gridY === gridY;
  });
}

// Called only while build mode is active (input.ts's router gates this). Places a rack/CRAC on
// an empty cell, or starts installing a machine into a rack under the cursor.
export function handleBuildModePlacement(
  world: World,
  controlled: EntityId,
  facility: EntityId,
  camera: Camera,
  pointer: { x: number; y: number },
  audio: Audio,
): void {
  const buildMode = world.getComponent(buildModes, controlled);
  if (!buildMode) return;
  const buildable = BUILDABLES.find((b) => b.id === buildMode.buildableId)!;
  const worldPoint = camera.screenToWorld(pointer);
  const { gridX, gridY } = worldToGrid(worldPoint.x, worldPoint.y);

  if (buildable.placement === 'empty-cell') {
    const room = getRoomRect(world, facility);
    const insideRoom =
      gridX >= room.minGridX &&
      gridX <= room.maxGridX &&
      gridY >= room.minGridY &&
      gridY <= room.maxGridY;
    if (!insideRoom) return;
    if (isGridCellOccupied(world, gridX, gridY)) return;
    if (!takeFromInventory(world, facility, buildable.id as PurchasableId)) return;

    if (buildable.id === 'crac') {
      spawnCoolingUnit(world, gridX, gridY);
    } else {
      spawnRack(world, gridX, gridY);
    }
    audio.play('rackPlaced');
    // Stay in build mode so a row of the same buildable can be laid out quickly.
    return;
  }

  if (buildable.placement === 'rack') {
    // buildable.id is `machine-${MachineTierId}` for every rack-placement buildable — strip the
    // prefix rather than hand-matching each tier id (see BUILDABLES in components.ts, generated
    // from MACHINE_TIERS).
    const tierId = buildable.id.slice('machine-'.length) as MachineTierId;
    const rackId = findRackAt(world, gridX, gridY);
    if (rackId !== null) {
      startInstall(world, controlled, facility, tierId, rackId);
    }
    world.removeComponent(buildModes, controlled);
  }
}
