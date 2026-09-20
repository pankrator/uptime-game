import { type World, type EntityId } from './world';
import { roomTiers } from './components';
import { ROOM_ORIGIN, ROOM_TIERS } from './game-data';
import type { GridBounds } from './pathfinding';

// The current room tier's interior cell rect — the one place that answers "where is the
// room", so pathfinding, rendering, and rack placement can't disagree.
export function getRoomRect(world: World, facility: EntityId): GridBounds {
  const tier = world.getComponent(roomTiers, facility);
  const def = ROOM_TIERS[tier?.index ?? 0];
  return {
    minGridX: ROOM_ORIGIN.gridX,
    minGridY: ROOM_ORIGIN.gridY,
    maxGridX: ROOM_ORIGIN.gridX + def.gridWidth - 1,
    maxGridY: ROOM_ORIGIN.gridY + def.gridHeight - 1,
  };
}

export function getNextRoomTier(world: World, facility: EntityId) {
  const tier = world.getComponent(roomTiers, facility);
  const index = tier?.index ?? 0;
  return ROOM_TIERS[index + 1] ?? null;
}
