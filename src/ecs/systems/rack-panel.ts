// Rack panel lifecycle: open/close (both D4 open paths), arrival detection, and committing any
// PendingDrop queued while walking. Drag-and-drop lands in step 8.
//
// Click ownership: input.ts owns ALL left-click handling as a single priority chain (wasClicked()
// is consumed-once, so only one system may react to a given click) — see its own comments for
// why. Rack clicks are handled there by calling openOrPromoteRackPanel from this module, rather
// than duplicating a second, likely-diverging click-priority chain here. This module's own
// System therefore only owns: right-click (a separate, non-conflicting event — the "view a
// rack" affordance), Escape, and the per-frame arrival/pending-drop-commit logic.
import { type World, type EntityId } from '../world';
import {
  positions,
  gridPositions,
  gridToWorld,
  worldToGrid,
  rackSlots,
  machines,
  installedIns,
  openRackPanels,
  pendingDrops,
  workloads,
  GRID_CELL_SIZE,
} from '../components';
import { type InputState } from '../../input';
import { placeWorkload, checkPlacement } from '../dispatch';
import { type System } from './system';

// Same reach radius/approach as install-progress.ts's INSTALL_REACH_PX — the established
// "close enough to interact with this rack" pattern.
export const DISPATCH_REACH_PX = GRID_CELL_SIZE * 1.2;

export function findRackAt(world: World, gridX: number, gridY: number): EntityId | null {
  for (const id of world.query(rackSlots, gridPositions)) {
    const grid = world.getComponent(gridPositions, id)!;
    if (grid.gridX === gridX && grid.gridY === gridY) return id;
  }
  return null;
}

// Server ids installed in a given rack, in slot order — the same grouping render.ts and
// capacity.ts each already do per-rack, just filtered to one rack instead of bucketing all of
// them (this module only ever needs one rack's servers at a time, for whichever panel is open).
export function serversOn(world: World, rackId: EntityId): EntityId[] {
  return world
    .query(machines, installedIns)
    .filter((id) => world.getComponent(installedIns, id)!.rackId === rackId)
    .sort((a, b) => world.getComponent(installedIns, a)!.slotIndex - world.getComponent(installedIns, b)!.slotIndex);
}

// Accepted-but-unplaced workload ids — the tray's contents (D3), same across every panel since
// the tray isn't rack-scoped.
export function trayWorkloadIds(world: World): EntityId[] {
  return world
    .query(workloads)
    .filter((id) => world.getComponent(workloads, id)!.state === 'accepted')
    .sort((a, b) => a - b);
}

export function closeRackPanel(world: World, controlled: EntityId): void {
  world.removeComponent(openRackPanels, controlled);
  for (const workloadId of world.query(pendingDrops)) {
    world.removeComponent(pendingDrops, workloadId);
  }
}

// Called from input.ts's click-priority chain when a rack was clicked in dispatch mode (the
// ordinary left-click — walks the player there). Handles opening a fresh panel, re-clicking
// the already-open one (no-op), and promoting an open viewing panel to dispatching (D4:
// "switching from a viewing panel to dispatching the same rack... flips mode to 'dispatching'
// and starts the walk" — the panel stays open throughout). Returns true if a walk should start.
export function openOrPromoteRackPanel(world: World, controlled: EntityId, rackId: EntityId): boolean {
  const current = world.getComponent(openRackPanels, controlled);

  if (current?.rackId === rackId) {
    if (current.mode === 'viewing') {
      current.mode = 'dispatching';
      current.arrived = false;
      return true;
    }
    return false; // already dispatching (or already arrived) at this rack — nothing to do
  }

  world.addComponent(openRackPanels, controlled, { rackId, mode: 'dispatching', arrived: false });
  return true;
}

export function createRackPanelSystem(
  world: World,
  input: InputState,
  controlled: EntityId,
): System {
  input.onKeyDown('Escape', () => {
    if (world.getComponent(openRackPanels, controlled)) {
      closeRackPanel(world, controlled);
    }
  });

  return {
    update() {
      const panel = world.getComponent(openRackPanels, controlled);

      // Arrival check for an open, not-yet-arrived dispatching panel.
      if (panel && panel.mode === 'dispatching' && !panel.arrived) {
        const position = world.getComponent(positions, controlled);
        const grid = world.getComponent(gridPositions, panel.rackId);
        if (position && grid) {
          const rackCenter = gridToWorld(grid.gridX, grid.gridY);
          const distance = Math.hypot(rackCenter.x - position.x, rackCenter.y - position.y);
          if (distance <= DISPATCH_REACH_PX) {
            panel.arrived = true;

            // Commit every PendingDrop queued while walking, in order, skipping any that no
            // longer fit (capacity may have shifted — a brownout, another placement — while
            // the player was en route).
            const drops = world.query(pendingDrops).sort((a, b) => a - b);
            for (const workloadId of drops) {
              const drop = world.getComponent(pendingDrops, workloadId)!;
              world.removeComponent(pendingDrops, workloadId);
              if (checkPlacement(world, workloadId, drop.serverId) === null) {
                placeWorkload(world, workloadId, drop.serverId);
              }
            }
          }
        }
      }

      // Right-click: open (or switch to) a viewing-mode panel on the rack under the pointer.
      // Never starts a walk — see D4, "inspecting a rack is remote". This is a separate event
      // from wasClicked(), so it never competes with input.ts's click chain.
      if (!input.wasRightClicked()) return;
      const pointer = input.getPointerPosition();
      if (!pointer) return;

      const { gridX, gridY } = worldToGrid(pointer.x, pointer.y);
      const rackId = findRackAt(world, gridX, gridY);
      if (rackId === null) return;

      const existing = world.getComponent(openRackPanels, controlled);
      // Right-clicking a rack that's already open dispatching keeps it dispatching — viewing
      // is strictly weaker, so this is a no-op rather than a demotion.
      if (!existing || existing.mode !== 'dispatching' || existing.rackId !== rackId) {
        world.addComponent(openRackPanels, controlled, { rackId, mode: 'viewing', arrived: false });
      }
    },
  };
}
