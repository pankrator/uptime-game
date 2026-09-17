// Presentation-only feedback: floating world-space text (e.g. "+$41" over a rack that just
// finished a contract) and screen-space toast banners (e.g. a miss notice, a resource-near-limit
// warning). Neither has any gameplay effect — this module exists so every OTHER system that
// wants to say "something happened" has one place to call into, instead of each inventing its
// own transient-entity bookkeeping. See .plans/playtest-findings.md F7 (and F4, which reuses the
// toast half for its pre-brownout warning).
//
// Spawn functions are called from wherever the event actually happens (workload-run.ts on
// completion/miss, resource.ts on a near-limit crossing) — this module only owns the entities'
// shape and their expiry, the same "spawn where it happens, expire centrally" split
// RejectedDrop/DecommissionConfirm already use, just centralized here since floating
// text/toasts are spawned from more than one system.
import { type World, type EntityId } from '../world';
import { floatingTexts, toasts } from '../components';
import { type System } from './system';

export const FLOATING_TEXT_DURATION_MS = 1400;
export const TOAST_DURATION_MS = 3200;

// Rises this many pixels over its lifetime — render.ts reads spawnedAtMs/expiresAtMs to compute
// how far in and fades accordingly, rather than this module ticking a position every frame.
export const FLOATING_TEXT_RISE_PX = 28;

export function spawnFloatingText(
  world: World,
  worldX: number,
  worldY: number,
  text: string,
  color: string,
): EntityId {
  const id = world.createEntity();
  const now = performance.now();
  world.addComponent(floatingTexts, id, {
    text,
    color,
    worldX,
    worldY,
    spawnedAtMs: now,
    expiresAtMs: now + FLOATING_TEXT_DURATION_MS,
  });
  return id;
}

export function spawnToast(world: World, text: string, color: string): EntityId {
  const id = world.createEntity();
  const now = performance.now();
  world.addComponent(toasts, id, {
    text,
    color,
    spawnedAtMs: now,
    expiresAtMs: now + TOAST_DURATION_MS,
  });
  return id;
}

export function createEffectsSystem(world: World): System {
  return {
    update() {
      const now = performance.now();
      for (const id of world.query(floatingTexts)) {
        if (now >= world.getComponent(floatingTexts, id)!.expiresAtMs) world.destroyEntity(id);
      }
      for (const id of world.query(toasts)) {
        if (now >= world.getComponent(toasts, id)!.expiresAtMs) world.destroyEntity(id);
      }
    },
  };
}
