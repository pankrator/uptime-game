import { createComponentStore, type EntityId } from './world';
import {
  MACHINE_TIERS,
  CRAC_UNIT,
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

export type RenderableKind = 'player-circle' | 'rack' | 'crac';

export interface Renderable {
  kind: RenderableKind;
}

export type PlacementKind = 'empty-cell' | 'rack';

// `machine-${MachineTierId}` so a new tier in MACHINE_TIERS (game-data.ts) automatically gets a
// BuildableId, a build-panel entry, and a number-key hotkey with no changes here — see
// .plans/workload-dispatch.md D6 and the BUILDABLES generalization below.
//
// As of .plans/facility-shop-inventory.md D6, the build panel only ever shows STOCK
// purchasables (rack, machines, crac) — power/cooling upgrades are 'instant' kind, bought and
// applied at the shop, never placed. BuildableId is a strict subset of PurchasableId.
export type BuildableId = 'rack' | `machine-${MachineTierId}` | 'crac';

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
  { id: 'crac', label: CRAC_UNIT.label, placement: 'empty-cell' },
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

// Lives on RACK entities. OWNED SOLELY BY thermal.ts — unlike RackLoad/ServerCapacity/
// Utilization, this is NOT a derived cache recomputed from scratch each tick. Heat has history:
// a rack that's been running hot for a minute is hot *now*, a fact not recoverable from this
// tick's RackLoad.heatKw alone, so thermal.ts integrates it incrementally instead. Do not "fix"
// this into a recompute — see .plans/thermal-and-cooling.md D2. throttleFactor (1 = full speed,
// 0 = stalled) is cached here too so workload-run.ts reads one number instead of re-deriving the
// throttle band from celsius itself.
export interface Temperature {
  celsius: number;
  throttleFactor: number;
}

// Marker on RACK entities currently tripped from overheating (celsius was >= TRIP_C, hasn't
// cooled back to TRIP_RECOVER_C yet). thermal.ts is the sole writer; resource.ts only reads it,
// as a veto on Powered.online candidacy — see .plans/thermal-and-cooling.md D7: two systems
// must never both write Powered.online directly, or a stuck-offline machine is a day-long bug.
export interface ThermalTrip {
  trippedAt: number;
}

// A placed CRAC unit — an entity with GridPosition + Renderable('crac') like a rack, plus this.
// See .plans/thermal-and-cooling.md D4.
export interface CoolingUnit {
  kwOutput: number;
  radiusCells: number;
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

// Per-machine wear, 0 (new) to 1 (worn out). Lives on MACHINE entities. OWNED SOLELY BY
// wear.ts — like Temperature, this is integrated state, not a derived cache: wear has history
// (how long has this box been running, hot, unrepaired) that this tick's inputs alone cannot
// reconstruct. Never recompute it from scratch. See .plans/hardware-failure.md D1/D2.
export interface Condition {
  wear: number;
}

// Marker on a MACHINE entity that has failed (a wear.ts failure roll came up positive). Sole
// writer is wear.ts; resource.ts only reads it, as a veto on Powered.online candidacy — the
// same one-writer-many-readers shape ThermalTrip already uses. Cleared only by a completed
// 'repair' MaintenanceTask (maintenance.ts). See .plans/hardware-failure.md D4/D7.
export interface Failed {
  failedAt: number;
}

// Walk-to-rack-then-work interaction, attached to the player. Generalizes the old InstallTask
// (D5) to cover repair and decommission too — all three share the identical walk/arrival/
// countdown shape; only what happens on completion differs, branched in maintenance.ts (the
// renamed install-progress.ts). See .plans/hardware-failure.md D5.
export type MaintenanceJob =
  | { kind: 'install'; tierId: MachineTierId; slotIndex: number }
  // cost is captured at task creation (the wear-scaled price shown on the repair button) and
  // debited up front, mirroring install's up-front inventory take — see rack-panel.ts.
  | { kind: 'repair'; machineId: EntityId; cost: number }
  | { kind: 'decommission'; machineId: EntityId };

export interface MaintenanceTask {
  rackId: EntityId;
  job: MaintenanceJob;
  secondsRemaining: number;
  totalSeconds: number;
  arrived: boolean;
}

// Facility singleton — derived cache, fully recomputed every frame. Written by more than one
// system (resource.ts and workload-run.ts write disjoint fields; capacity.ts writes the
// traits/compute fields) — see .plans/power-billing.md step 3. A third writer means this should
// be split by owner.
export interface Utilization {
  powerDrawKw: number;
  coolingDrawKw: number;
  computeTotal: number;
  computeFree: number;
  // Step 2: added alongside computeTotal/computeFree, filled by capacity.ts. Step 3/4 removes
  // the compute-only pair once capacity.ts is the sole source of facility-wide free capacity.
  traitsTotal: Traits;
  traitsFree: Traits;
  // .plans/power-billing.md: derived (power + cooling) * POWER_COST_PER_KW_SECOND, written by
  // resource.ts.
  powerCostPerSecond: number;
  // .plans/power-billing.md: sum of payPerSecond over running (placed + online) workloads,
  // written by workload-run.ts.
  revenuePerSecond: number;
}

// Facility singleton — one-shot "we're near the wall" toast tracking, owned solely by
// resource.ts (see RESOURCE_WARNING_FRACTION/RESOURCE_WARNING_CLEAR_FRACTION in game-data.ts
// and .plans/playtest-findings.md F4). true once the warning toast has fired for that resource
// at the current approach; resource.ts resets it back to false once draw falls back under the
// (lower) clear threshold, so the SAME crossing never re-fires every tick but a later, separate
// approach still gets its own warning.
export interface ResourceWarning {
  powerNearLimit: boolean;
  coolingNearLimit: boolean;
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

// Attached to a workload when resource.ts's unplaceAllOn forcibly unplaces it (a brownout or
// thermal trip taking its server offline — NOT a player-initiated drag back to the tray, which
// never tags this). If `serverId` comes back online again before `expiresAtMs`, resource.ts
// re-places the workload there automatically instead of leaving it for the player to notice and
// re-drag. One-shot: consumed (removed) the first time that server is checked, whether or not
// the restore actually happens (already re-placed elsewhere, no longer fits, or the window
// lapsed). See .plans/playtest-findings.md F4 and BROWNOUT_RESTORE_GRACE_SECONDS in
// game-data.ts.
export interface RecentlyUnplaced {
  serverId: EntityId;
  expiresAtMs: number;
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

// Marker on the player — the offers panel (jobs available to accept) is open. Toggled by the
// `O` key (job-panels.ts) rather than opened automatically — mirrors ShopOpen's shape (a plain
// toggle, no travel/arrival state) but is player-initiated instead of proximity-driven. Only one
// of this, JobsPanelOpen, OpenRackPanel, or ShopOpen is ever open at a time — see job-panels.ts.
export interface OffersPanelOpen {
  open: true;
}

// How far the offers panel's list has scrolled, in pixels. Attached to the player alongside
// OffersPanelOpen; reset to 0 whenever the panel opens.
export interface OffersPanelScroll {
  offsetPx: number;
}

// Marker on the player — the jobs panel (every accepted job — unplaced + running — with full
// stats) is open. Same toggle shape as OffersPanelOpen, bound to the `J` key.
export interface JobsPanelOpen {
  open: true;
}

export interface JobsPanelScroll {
  offsetPx: number;
}

// A decommission button was clicked once — the second click on the SAME button, within the
// window, actually destroys the machine (D6: "a second click to confirm on the same button is
// enough; no modal"). Attached to the player; cleared on confirm, expiry, or the panel closing.
// See .plans/hardware-failure.md Step 6.
export interface DecommissionConfirm {
  serverId: EntityId;
  expiresAtMs: number;
}

// An unservable offer's Accept button was clicked once — the second click on the SAME button,
// within the window, actually accepts it. Same "second click to confirm, no modal" shape as
// DecommissionConfirm above; a SERVABLE offer never sets this at all, so the common case (most
// offers, most of the time) still accepts on the first click exactly as before. Attached to the
// player; cleared on confirm, expiry, or accepting/declining any other offer. See
// .plans/playtest-findings.md F3.
export interface AcceptConfirm {
  offerId: EntityId;
  expiresAtMs: number;
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
// Explicitly declining costs a small amount of reputation (REPUTATION_ON_DECLINE, applied in
// dispatch.ts's declineOffer) — letting the offer silently expire instead does not (see
// createOfferExpirySystem in workload-spawn.ts). The accept/decline choice is the actual
// difficulty dial now, not passive demand escalation. See .plans/workload-dispatch.md "New
// loop", the Offer section under Data model changes, and .plans/contract-variety.md step 3.
export interface Offer {
  archetypeId: WorkloadArchetypeId;
  demands: Traits;
  workSeconds: number;
  deadlineSeconds: number;
  payPerSecond: number;
  secondsRemaining: number; // offer auto-declines at 0, no reputation penalty
  // Which offers-panel card (0..MAX_OFFERS-1) this offer draws/hit-tests in, assigned once at
  // spawn (entities.ts's spawnOffer) and fixed for the offer's whole lifetime. Positional
  // indexing into a sorted-by-id array used to make every later offer's card shift up — and the
  // pointer land on the wrong one — the instant an earlier offer expired; see
  // .plans/playtest-findings.md F6.
  slot: number;
  // See .plans/contract-variety.md D1/D2 — carried straight into the Workload on accept.
  penaltyOnMiss: number;
  repeatCount: number; // extra cycles after the first; 0 = one-shot
  repeatTotal: number; // repeatCount + 1, fixed at roll time, for "current/total" display
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
  // See .plans/contract-variety.md D1/D2.
  penaltyOnMiss: number; // money lost, on top of the reputation hit, if this deadline is missed
  repeatCount: number; // cycles left AFTER the current one; on completion with repeatCount > 0,
  // the workload resets and stays placed instead of being destroyed (D2/D3 — survives
  // unplace/re-place with this intact).
  repeatTotal: number; // fixed at accept time; current cycle = repeatTotal - repeatCount
}

// Cycle suffix for a recurring workload — '' for a one-shot, ' 3/5' once repeatTotal > 1.
// Shared by render.ts (tray card, placed chip) and hud.ts (workload panel rows) so the
// current/total math lives in one place. See .plans/contract-variety.md D2.
export function cycleLabel(workload: Workload): string {
  if (workload.repeatTotal <= 1) return '';
  return ` ${workload.repeatTotal - workload.repeatCount}/${workload.repeatTotal}`;
}

// Facility singleton — guided-tutorial progress (see systems/tutorial.ts). moveOrigin is
// captured once, when the tutorial starts, so the 'move' step can be checked as distance
// travelled from a fixed point rather than a specific destination (the player can walk
// anywhere). skipped short-circuits every remaining step's banner/advance check but is
// otherwise identical to reaching 'done' the long way.
export type TutorialStepId =
  | 'welcome'
  | 'move'
  | 'build-rack'
  | 'install-machine'
  | 'open-rack-panel'
  | 'visit-shop'
  | 'accept-offer'
  | 'place-workload'
  | 'done';

export interface TutorialProgress {
  stepId: TutorialStepId;
  moveOrigin: { x: number; y: number };
  // Set by tutorial.ts's recordShopPurchase, called from input.ts only when shop.ts's buy()
  // reports a purchase actually went through (see shop.ts's buy return value) — a rejected
  // click (can't afford it) must not advance the 'visit-shop' step.
  shopPurchased: boolean;
  skipped: boolean;
}

// Marker on the player entity — lets save/load (src/save/) find the player singleton after a
// load without hardcoding an entity id in the save format. See .plans/save-load.md D5.
export type PlayerTag = Record<string, never>;

// Marker on the facility entity — same reasoning as PlayerTag.
export type FacilityTag = Record<string, never>;

// Presentation-only "+$N" (or similar) text that rises and fades at a fixed world position —
// e.g. over the rack a contract just completed on. Its own entity (no Position/Renderable: it
// needs no pathfinding/collision/z-ordering, just a world coordinate to draw at), spawned and
// expired by effects.ts, drawn by render.ts inside the camera transform so it tracks the floor
// like any other world object. See .plans/playtest-findings.md F7.
export interface FloatingText {
  text: string;
  color: string;
  worldX: number;
  worldY: number;
  spawnedAtMs: number;
  expiresAtMs: number;
}

// Presentation-only screen-space banner — e.g. a contract-missed notice or a resource-near-limit
// warning. Unlike FloatingText this has no world position; drawn by hud.ts, stacked by spawn
// order. Spawned and expired by effects.ts. See .plans/playtest-findings.md F4/F7.
export interface Toast {
  text: string;
  color: string;
  spawnedAtMs: number;
  expiresAtMs: number;
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
export const temperatures = createComponentStore<Temperature>();
export const thermalTrips = createComponentStore<ThermalTrip>();
export const coolingUnits = createComponentStore<CoolingUnit>();
export const machines = createComponentStore<Machine>();
export const installedIns = createComponentStore<InstalledIn>();
export const powereds = createComponentStore<Powered>();
export const conditions = createComponentStore<Condition>();
export const faileds = createComponentStore<Failed>();
export const maintenanceTasks = createComponentStore<MaintenanceTask>();
export const serverCapacities = createComponentStore<ServerCapacity>();

export const utilizations = createComponentStore<Utilization>();
export const resourceWarnings = createComponentStore<ResourceWarning>();
export const demandClocks = createComponentStore<DemandClock>();
export const placedOns = createComponentStore<PlacedOn>();
export const recentlyUnplaceds = createComponentStore<RecentlyUnplaced>();
export const workloads = createComponentStore<Workload>();
export const offers = createComponentStore<Offer>();
export const openRackPanels = createComponentStore<OpenRackPanel>();
export const rackScrolls = createComponentStore<RackScroll>();
export const shopOpens = createComponentStore<ShopOpen>();
export const offersPanelOpens = createComponentStore<OffersPanelOpen>();
export const offersPanelScrolls = createComponentStore<OffersPanelScroll>();
export const jobsPanelOpens = createComponentStore<JobsPanelOpen>();
export const jobsPanelScrolls = createComponentStore<JobsPanelScroll>();
export const pendingDrops = createComponentStore<PendingDrop>();
export const dragStates = createComponentStore<DragState>();
export const decommissionConfirms = createComponentStore<DecommissionConfirm>();
export const acceptConfirms = createComponentStore<AcceptConfirm>();
export const rejectedDrops = createComponentStore<RejectedDrop>();
export const tutorialProgresses = createComponentStore<TutorialProgress>();
export const playerTags = createComponentStore<PlayerTag>();
export const facilityTags = createComponentStore<FacilityTag>();
export const floatingTexts = createComponentStore<FloatingText>();
export const toasts = createComponentStore<Toast>();
