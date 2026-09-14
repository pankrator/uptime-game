import { createComponentStore, type EntityId } from './world';
import {
  RACK_COST,
  MACHINE_TIERS,
  POWER_UPGRADE_COST,
  COOLING_UPGRADE_COST,
  type MachineTierId,
  type WorkloadArchetypeId,
  type Traits,
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

// `machine-${MachineTierId}` so a new tier in MACHINE_TIERS (game-data.ts) automatically gets a
// BuildableId, a build-panel entry, and a number-key hotkey with no changes here — see
// .plans/workload-dispatch.md D6 and the BUILDABLES generalization below.
export type BuildableId = 'rack' | `machine-${MachineTierId}` | 'power-upgrade' | 'cooling-upgrade';

export interface BuildableDef {
  id: BuildableId;
  label: string;
  cost: number;
  placement: PlacementKind;
}

const machineBuildables: BuildableDef[] = Object.values(MACHINE_TIERS).map((tier) => ({
  id: `machine-${tier.id}` as BuildableId,
  label: tier.label,
  cost: tier.cost,
  placement: 'rack',
}));

export const BUILDABLES: BuildableDef[] = [
  { id: 'rack', label: 'Rack', cost: RACK_COST, placement: 'empty-cell' },
  ...machineBuildables,
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

// Per-rack power/heat rollup — derived cache, recomputed every frame by capacity.ts from the
// rack's installed machines. Lives on the RACK entity. Read straight off by render.ts for the
// under-rack power/heat labels.
export interface RackLoad {
  powerKw: number;
  heatKw: number;
  serverCount: number;
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

// Mutable free capacity for a server — derived cache, recomputed every frame by capacity.ts
// from the server's tier traits minus the demands of every workload placed on it. Never
// hand-edited outside capacity.ts. Lives on the MACHINE entity (a "server" in dispatch
// terminology). See .plans/workload-dispatch.md.
export interface ServerCapacity {
  total: Traits;
  free: Traits;
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

// Facility singleton — derived cache, fully recomputed every frame
export interface Utilization {
  powerDrawKw: number;
  coolingDrawKw: number;
  computeTotal: number;
  computeFree: number;
  // Step 2: added alongside computeTotal/computeFree, filled by capacity.ts. Step 3/4 removes
  // the compute-only pair once capacity.ts is the sole source of facility-wide free capacity.
  traitsTotal: Traits;
  traitsFree: Traits;
}

export interface DemandClock {
  elapsedSeconds: number;
  nextArrivalInSeconds: number;
  contractsServed: number;
  peakComputeServed: number; // the score
}

// Placement of a workload onto a server. Lives on the WORKLOAD entity (see D1: one workload
// occupies exactly one server), the inverse of the old Assignment (which lived on the
// machine). Replaces Assignment as of step 3.
export interface PlacedOn {
  serverId: EntityId;
}

// Workloads — their own entities, with no Position and no Renderable
export type WorkloadState = 'pending' | 'running';

export interface Workload {
  archetypeId: WorkloadArchetypeId;
  demands: Traits; // step 1: replaces computeRequired; step 4 adds deadline/work-remaining split
  durationSeconds: number;
  elapsedSeconds: number;
  payPerSecond: number;
  graceRemainingSeconds: number;
  state: WorkloadState;
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
export const rackLoads = createComponentStore<RackLoad>();
export const machines = createComponentStore<Machine>();
export const installedIns = createComponentStore<InstalledIn>();
export const powereds = createComponentStore<Powered>();
export const installTasks = createComponentStore<InstallTask>();
export const serverCapacities = createComponentStore<ServerCapacity>();

export const utilizations = createComponentStore<Utilization>();
export const demandClocks = createComponentStore<DemandClock>();
export const placedOns = createComponentStore<PlacedOn>();
export const workloads = createComponentStore<Workload>();
