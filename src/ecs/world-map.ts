import { type World, type EntityId } from './world';
import { ROOM_ORIGIN, ROOM_TIERS } from './game-data';
import { getRoomRect } from './room';
import type { GridBounds } from './pathfinding';

// Shop building, placed beyond the largest room tier's footprint, reached via an outdoor
// corridor along the room's TOP edge — the one edge that stays fixed across every tier (D4:
// tiers grow right and down from a fixed top-left origin, so top and left never move). A
// corridor anchored to the right or bottom edge would only reach the shop once the room was
// fully upgraded to its largest tier; anchoring to the top keeps the shop reachable from tier 0.
const largestTier = ROOM_TIERS[ROOM_TIERS.length - 1];
const CORRIDOR_HEIGHT = 4; // grid cells, the strip's thickness running along the top edge
const CORRIDOR_ROW_MIN = ROOM_ORIGIN.gridY - CORRIDOR_HEIGHT;
const CORRIDOR_ROW_MAX = ROOM_ORIGIN.gridY - 1;

const SHOP_WIDTH = 8;
const SHOP_HEIGHT = 6;
const SHOP_ORIGIN_X = ROOM_ORIGIN.gridX + largestTier.gridWidth + 4;
const SHOP_ORIGIN_Y = CORRIDOR_ROW_MIN - SHOP_HEIGHT + CORRIDOR_HEIGHT;

export const SHOP_RECT: GridBounds = {
  minGridX: SHOP_ORIGIN_X,
  minGridY: SHOP_ORIGIN_Y,
  maxGridX: SHOP_ORIGIN_X + SHOP_WIDTH - 1,
  maxGridY: SHOP_ORIGIN_Y + SHOP_HEIGHT - 1,
};

// Runs the full width from the room's fixed left edge to the shop, along the top — adjacent
// to every room tier's top edge (since ROOM_ORIGIN.gridY never moves) and to the shop's
// bottom edge.
export const CORRIDOR_RECT: GridBounds = {
  minGridX: ROOM_ORIGIN.gridX,
  minGridY: CORRIDOR_ROW_MIN,
  maxGridX: SHOP_RECT.maxGridX,
  maxGridY: CORRIDOR_ROW_MAX,
};

export const SHOP_DOOR = {
  gridX: SHOP_ORIGIN_X + Math.floor(SHOP_WIDTH / 2),
  gridY: SHOP_RECT.minGridY,
};

export interface WorldRegions {
  regions: GridBounds[];
}

export function getWalkableRegions(world: World, facility: EntityId): WorldRegions {
  return {
    regions: [getRoomRect(world, facility), CORRIDOR_RECT, SHOP_RECT],
  };
}
