// The single place mapping a domain event (game-events.ts) to a sound, so individual systems
// only need to know that something happened, not who's listening or what it sounds like.
// Called once from main.ts's runGame(), the same "wire it up once, outside any system's
// update()" treatment registerModalCloser calls get in rack-panel.ts/shop.ts/job-panels.ts.
import { type EventBus } from './event-bus';
import { type GameEvents } from './game-events';
import { type Audio } from '../audio';

export function wireAudioEvents(events: EventBus<GameEvents>, audio: Audio): void {
  events.on('machine:installed', () => audio.play('machineInstalled'));
  events.on('machine:repaired', () => audio.play('machineRepaired'));
  events.on('machine:decommissioned', () => audio.play('machineDecommissioned'));
  events.on('machine:failed', () => audio.play('machineFailed'));
  // Same sound for both causes today (see game-events.ts's note on why they're still separate
  // event types) — may fire more than once per tick if several machines go offline together,
  // acceptable for a sub-300ms sound.
  events.on('machine:browned-out', () => audio.play('brownout'));
  events.on('machine:thermal-tripped', () => audio.play('brownout'));
  events.on('contract:completed', () => audio.play('contractCompleted'));
  events.on('contract:missed', () => audio.play('contractMissed'));
}
