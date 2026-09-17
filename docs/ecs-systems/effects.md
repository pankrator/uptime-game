# effects

`src/ecs/systems/effects.ts` — `createEffectsSystem(world)`, plus exported
`spawnFloatingText`/`spawnToast`

## Purpose

Presentation-only feedback: floating world-space text (e.g. `+$41` over a rack that just
finished a contract) and screen-space toast banners (e.g. a miss notice, a resource-near-
limit warning). Neither has any gameplay effect. See `.plans/playtest-findings.md` F7 (and
F4, which reuses the toast half for its pre-brownout warning).

## Reads / writes

- Writes: `FloatingText`, `Toast` (spawns on `spawnFloatingText`/`spawnToast`, destroys the
  entity once `performance.now() >= expiresAtMs`)

## Structure

- `spawnFloatingText(world, worldX, worldY, text, color)` / `spawnToast(world, text,
  color)` — called from wherever the event actually happens: `workload-run.ts` on
  completion/miss, `resource.ts` on a near-limit crossing. This module only owns the
  entities' shape and their expiry — the same "spawn where it happens, expire centrally"
  split `RejectedDrop`/`DecommissionConfirm` already use, centralized here since
  floating text/toasts are spawned from more than one system.
- `createEffectsSystem(world)` — the only system logic: each tick, destroys any
  `FloatingText`/`Toast` whose `expiresAtMs` has passed.
- Drawn by [render](./render.md) (`FloatingText`, world-space) and [hud](./hud.md)
  (`Toast`, screen-space) — this module never draws anything itself.

## Notes

- `FLOATING_TEXT_RISE_PX` is exported so `render.ts` can derive how far a floating text
  has risen from `spawnedAtMs`/`expiresAtMs` alone, rather than this module ticking a
  position every frame.
- Runs late in `updateSystems` (after `workload-run`) purely for narrative ordering —
  expiry is timestamp-based, so there's no real ordering dependency. See the
  [update order](./README.md#update-order).
