import { createComponentStore, type EntityId } from './world';
import {
  RACK_COST,
  MACHINE_TIERS,
  POWER_UPGRADE_COST,
  COOLING_UPGRADE_COST,
  type MachineTierId,
} from './game-data';

export const GRID_CELL_SIZE = 40;
export const BUILDING_MARGIN = 24;

export function worldToGrid(x: number, y: number): { gridX: number; gridY: number } {
  return {
    gridX: Math.floor(x / GRID_CELL_SIZE),
    gridY: Math.floor(y / GRID_CELL_SIZE),
  };
}

export function gridToWorld(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: gridX * GRID_CELL_SIZE + GRID_CELL_SIZE / 2,
    y: gridY * GRID_CELL_SIZE + GRID_CELL_SIZE / 2,
  };
}

export interface Position {
  x: number;
  y: number;
}

export interface MoveTarget {
  x: number;
  y: number;
}

export interface Speed {
  pixelsPerSecond: number;
}

export interface GridPosition {
  gridX: number;
  gridY: number;
}

export interface GridCell {
  gridX: number;
  gridY: number;
}

export interface PathFollow {
  path: { x: number; y: number }[];
  index: number;
}

export type RenderableKind = 'player-circle' | 'rack';

export interface Renderable {
  kind: RenderableKind;
}

export type PlacementKind = 'empty-cell' | 'rack' | 'purchase';

export type BuildableId = 'rack' | 'machine-basic' | 'machine-dense' | 'power-upgrade' | 'cooling-upgrade';

export interface BuildableDef {
  id: BuildableId;
  label: string;
  cost: number;
  placement: PlacementKind;
}

export const BUILDABLES: BuildableDef[] = [
  { id: 'rack', label: 'Rack', cost: RACK_COST, placement: 'empty-cell' },
  { id: 'machine-basic', label: 'Server', cost: MACHINE_TIERS.basic.cost, placement: 'rack' },
  { id: 'machine-dense', label: 'Blades', cost: MACHINE_TIERS.dense.cost, placement: 'rack' },
  { id: 'power-upgrade', label: '+5kW Power', cost: POWER_UPGRADE_COST, placement: 'purchase' },
  { id: 'cooling-upgrade', label: '+5kW Cool', cost: COOLING_UPGRADE_COST, placement: 'purchase' },
];

export interface BuildMode {
  buildableId: BuildableId;
}

// Facility singleton
export interface Wallet {
  money: number;
}

export interface Reputation {
  value: number;
}

export interface PowerCapacity {
  kw: number;
}

export interface CoolingCapacity {
  kw: number;
}

// Racks
export interface RackSlots {
  capacity: number;
}

// Machines
export interface Machine {
  tierId: MachineTierId;
}

export interface InstalledIn {
  rackId: EntityId;
  slotIndex: number;
}

export interface Powered {
  online: boolean;
  offlineCooldown: number;
}

// Install interaction (attached to the player)
export interface InstallTask {
  rackId: EntityId;
  tierId: MachineTierId;
  slotIndex: number;
  secondsRemaining: number;
  totalSeconds: number;
  arrived: boolean;
}

export const positions = createComponentStore<Position>();
export const moveTargets = createComponentStore<MoveTarget>();
export const speeds = createComponentStore<Speed>();
export const gridPositions = createComponentStore<GridPosition>();
export const renderables = createComponentStore<Renderable>();
export const buildModes = createComponentStore<BuildMode>();
export const pathFollows = createComponentStore<PathFollow>();

export const wallets = createComponentStore<Wallet>();
export const reputations = createComponentStore<Reputation>();
export const powerCapacities = createComponentStore<PowerCapacity>();
export const coolingCapacities = createComponentStore<CoolingCapacity>();
export const rackSlots = createComponentStore<RackSlots>();
export const machines = createComponentStore<Machine>();
export const installedIns = createComponentStore<InstalledIn>();
export const powereds = createComponentStore<Powered>();
export const installTasks = createComponentStore<InstallTask>();
