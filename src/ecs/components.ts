import { createComponentStore, type EntityId } from './world';
import {
  MACHINE_TIERS,
  type MachineTierId,
  type WorkloadArchetypeId,
  type PurchasableId,
  type Traits,
  type TraitKey,
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

export type PlacementKind = 'empty-cell' | 'rack';

// `machine-${MachineTierId}` so a new tier in MACHINE_TIERS (game-data.ts) automatically gets a
// BuildableId, a build-panel entry, and a number-key hotkey with no changes here — see
// .plans/workload-dispatch.md D6 and the BUILDABLES generalization below.
//
// As of .plans/facility-shop-inventory.md D6, the build panel only ever shows STOCK
// purchasables (rack, machines) — power/cooling upgrades are 'instant' kind, bought and
// applied at the shop, never placed. BuildableId is a strict subset of PurchasableId.
export type BuildableId = 'rack' | `machine-${MachineTierId}`;

export interface BuildableDef {
  id: BuildableId;
  label: string;
  placement: PlacementKind;
}

const machineBuildables: BuildableDef[] = Object.values(MACHINE_TIERS).map((tier) => ({
  id: `machine-${tier.id}` as BuildableId,
  label: tier.label,
  placement: 'rack',
}));

export const BUILDABLES: BuildableDef[] = [
  { id: 'rack', label: 'Rack', placement: 'empty-cell' },
  ...machineBuildables,
];

export interface BuildMode {
  buildableId: BuildableId;
}

// Facility singleton — which rung of ROOM_TIERS (game-data.ts) the room is currently on.
export interface RoomTier {
  index: number;
}

// Facility singleton — owned-but-unplaced stock, keyed by purchasable id (D5). A count is the
// whole truth for an owned item: no position, no behavior, no per-item state, so no entity is
// spawned until placement. Only 'stock'-kind purchasables (game-data.ts) ever appear here —
// 'instant' and 'room' purchases apply immediately and never touch inventory.
export interface Inventory {
  counts: Partial<Record<PurchasableId, number>>;
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

// Which rack's panel is open. Attached to the player. A panel can be opened purely to view
// (mode: 'viewing', no travel) or opened to dispatch (mode: 'dispatching', which kicks off a
// walk to the rack). Only 'dispatching' ever accepts drags — see D4.
export interface OpenRackPanel {
  rackId: EntityId;
  mode: 'viewing' | 'dispatching';
  arrived: boolean; // dispatching only; false while walking, drops held until true
}

// How far the open rack panel's content (server rows + tray) has scrolled, in pixels. Attached
// to the player alongside OpenRackPanel; reset to 0 whenever a panel opens (see
// openOrPromoteRackPanel/createRackPanelSystem in rack-panel.ts) so a new rack always opens
// scrolled to the top. Clamped every frame to [0, maxScroll] since the content height (and thus
// how far it CAN scroll) changes as servers/workloads are added or removed.
export interface RackScroll {
  offsetPx: number;
}

// Marker on the player — the shop panel is open. Mirrors OpenRackPanel but the shop has no
// mode/rackId: proximity alone opens and closes it (shop.ts), no travel state to track. See
// .plans/facility-shop-inventory.md Step 5.
export interface ShopOpen {
  open: true;
}

// A drop the player made while still walking to a dispatching-mode rack — committed on
// arrival, in order. See OpenRackPanel.arrived and rack-panel.ts.
export interface PendingDrop {
  workloadId: EntityId;
  serverId: EntityId;
}

// Transient drag state. Attached to the player; exists only between mousedown and mouseup.
export interface DragState {
  workloadId: EntityId;
  pointer: { x: number; y: number };
  origin: 'tray' | { serverId: EntityId }; // where it came from, for cancel/revert
}

// A drop just got rejected (didn't fit) — attached to the player for a short window so
// render.ts can flash the blocking trait bars red. Cleared by rack-panel.ts once it expires.
// See .plans/workload-dispatch.md step 8: "Doesn't fit → reject, flash the blocking trait bars
// red, card returns to origin."
export interface RejectedDrop {
  serverId: EntityId;
  blocking: TraitKey[];
  expiresAtMs: number;
}

// An offered contract awaiting accept/decline. Its own entity; no Position, no Renderable.
// Turning this down costs nothing (see REPUTATION_ON_DECLINE) — the accept/decline choice is
// the actual difficulty dial now, not passive demand escalation. See
// .plans/workload-dispatch.md "New loop" and the Offer section under Data model changes.
export interface Offer {
  archetypeId: WorkloadArchetypeId;
  demands: Traits;
  workSeconds: number;
  deadlineSeconds: number;
  payPerSecond: number;
  secondsRemaining: number; // offer auto-declines at 0, no reputation penalty
}

// Workloads — their own entities, with no Position and no Renderable. 'accepted' means
// "accepted, not yet placed" (an unplaced workload sitting in the tray); 'running' means
// placed on an online server.
export type WorkloadState = 'accepted' | 'running';

// D2: a single finish deadline, not separate start/finish deadlines. deadlineRemainingSeconds
// ticks ALWAYS from acceptance (whether sitting unplaced or running); workRemainingSeconds only
// ticks while running. Sitting unplaced burns the player's own deadline margin, with no
// separate start-deadline penalty to track. See .plans/workload-dispatch.md D2.
export interface Workload {
  archetypeId: WorkloadArchetypeId;
  demands: Traits;
  workSeconds: number; // total time ON a server needed to finish, once placed
  workRemainingSeconds: number;
  payPerSecond: number;
  deadlineRemainingSeconds: number;
  state: WorkloadState;
}

export const positions = createComponentStore<Position>();
export const moveTargets = createComponentStore<MoveTarget>();
export const speeds = createComponentStore<Speed>();
export const gridPositions = createComponentStore<GridPosition>();
export const renderables = createComponentStore<Renderable>();
export const buildModes = createComponentStore<BuildMode>();
export const pathFollows = createComponentStore<PathFollow>();

export const roomTiers = createComponentStore<RoomTier>();
export const inventories = createComponentStore<Inventory>();
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
export const offers = createComponentStore<Offer>();
export const openRackPanels = createComponentStore<OpenRackPanel>();
export const rackScrolls = createComponentStore<RackScroll>();
export const shopOpens = createComponentStore<ShopOpen>();
export const pendingDrops = createComponentStore<PendingDrop>();
export const dragStates = createComponentStore<DragState>();
export const rejectedDrops = createComponentStore<RejectedDrop>();
