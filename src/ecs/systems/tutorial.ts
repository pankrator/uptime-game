import { type World, type EntityId } from '../world';
import {
  positions,
  rackSlots,
  machines,
  openRackPanels,
  workloads,
  placedOns,
  tutorialProgresses,
  GRID_CELL_SIZE,
  type TutorialStepId,
} from '../components';
import { type System } from './system';

export interface TutorialStepDef {
  id: TutorialStepId;
  title: string;
  body: string;
}

// Order matters — advanceTutorial walks this array forward one entry at a time. 'welcome' and
// 'done' have no world-state completion check (see checkStepComplete): they only advance via
// the banner's own primary button, handled in input.ts.
export const TUTORIAL_STEPS: TutorialStepDef[] = [
  {
    id: 'welcome',
    title: 'Welcome to Uptime',
    body:
      'Walk the floor, rack up servers, and keep contracts running before their deadlines hit. ' +
      "Let's walk through the basics.",
  },
  {
    id: 'move',
    title: 'Get moving',
    body: 'Click anywhere on the floor to walk your manager there.',
  },
  {
    id: 'build-rack',
    title: 'Place a rack',
    body: 'Press 1 (or click the Rack icon, bottom-left), then click an empty floor tile to place it.',
  },
  {
    id: 'install-machine',
    title: 'Install a server',
    body: 'Press 2, pick a machine, then click your rack to install it. You have two Budget Boxes in stock.',
  },
  {
    id: 'open-rack-panel',
    title: 'Open the rack',
    body: "Click your rack to open its panel and see what's installed.",
  },
  {
    id: 'visit-shop',
    title: 'Visit the shop',
    body: 'Walk to the shop building along the corridor, then buy anything — a rack, a machine, or a power/cooling upgrade.',
  },
  {
    id: 'accept-offer',
    title: 'Accept a contract',
    body: 'Press O to see offers as they arrive, then click Accept — you need one running to earn money.',
  },
  {
    id: 'place-workload',
    title: 'Dispatch it',
    body: 'Open the rack panel and drag the workload from the tray onto an online server with room for it.',
  },
  {
    id: 'done',
    title: "You're running",
    body: "Build capacity, take contracts, keep them online before the deadline. That's the loop — the rest is up to you.",
  },
];

const TUTORIAL_STEP_ORDER = TUTORIAL_STEPS.map((step) => step.id);

// Steps with no automatic world-state completion check — they only advance via the banner's
// own primary button (input.ts), since there's no single gameplay action that means "read the
// intro" or "acknowledge the outro".
export function isTutorialActionStep(stepId: TutorialStepId): boolean {
  return stepId === 'welcome' || stepId === 'done';
}

export function getTutorialStepDef(stepId: TutorialStepId): TutorialStepDef {
  return TUTORIAL_STEPS.find((step) => step.id === stepId)!;
}

export function startTutorial(
  world: World,
  facility: EntityId,
  playerPosition: { x: number; y: number },
): void {
  world.addComponent(tutorialProgresses, facility, {
    stepId: 'welcome',
    moveOrigin: { x: playerPosition.x, y: playerPosition.y },
    shopPurchased: false,
    skipped: false,
  });
}

// Called from input.ts's buy-button click handler only when shop.ts's buy() reports the
// purchase actually went through — a click that gets rejected (can't afford it) must not
// silently advance the 'visit-shop' step.
export function recordShopPurchase(world: World, facility: EntityId): void {
  const progress = world.getComponent(tutorialProgresses, facility);
  if (!progress) return;
  progress.shopPurchased = true;
}

export function advanceTutorial(world: World, facility: EntityId): void {
  const progress = world.getComponent(tutorialProgresses, facility);
  if (!progress) return;
  const nextIndex = TUTORIAL_STEP_ORDER.indexOf(progress.stepId) + 1;
  if (nextIndex < TUTORIAL_STEP_ORDER.length) {
    progress.stepId = TUTORIAL_STEP_ORDER[nextIndex];
  }
}

// Dismisses the banner for good — used both for an explicit mid-tutorial skip and for
// acknowledging the final 'done' step. Either way the player's already-real progress (rack,
// machine, wallet, workload) is untouched; this only hides the guidance overlay.
export function skipTutorial(world: World, facility: EntityId): void {
  const progress = world.getComponent(tutorialProgresses, facility);
  if (!progress) return;
  progress.skipped = true;
}

// Distance travelled from where the tutorial started, rather than a specific destination —
// the player can walk anywhere to satisfy the 'move' step.
const MOVE_COMPLETE_DISTANCE_PX = GRID_CELL_SIZE * 2;

function isCurrentStepComplete(
  world: World,
  controlled: EntityId,
  progress: {
    stepId: TutorialStepId;
    moveOrigin: { x: number; y: number };
    shopPurchased: boolean;
  },
): boolean {
  switch (progress.stepId) {
    case 'move': {
      const position = world.getComponent(positions, controlled);
      if (!position) return false;
      const dx = position.x - progress.moveOrigin.x;
      const dy = position.y - progress.moveOrigin.y;
      return Math.hypot(dx, dy) >= MOVE_COMPLETE_DISTANCE_PX;
    }
    case 'build-rack':
      return world.query(rackSlots).length >= 1;
    case 'install-machine':
      return world.query(machines).length >= 1;
    case 'open-rack-panel': {
      const panel = world.getComponent(openRackPanels, controlled);
      return !!panel && (panel.mode === 'viewing' || panel.arrived);
    }
    case 'visit-shop':
      return progress.shopPurchased;
    case 'accept-offer':
      return world.query(workloads).length >= 1;
    case 'place-workload':
      return world.query(placedOns).length >= 1;
    default:
      return false; // 'welcome' and 'done' — see isTutorialActionStep
  }
}

export function createTutorialSystem(
  world: World,
  controlled: EntityId,
  facility: EntityId,
): System {
  return {
    update() {
      const progress = world.getComponent(tutorialProgresses, facility);
      if (!progress || progress.skipped || isTutorialActionStep(progress.stepId)) return;

      if (isCurrentStepComplete(world, controlled, progress)) {
        advanceTutorial(world, facility);
      }
    },
  };
}
