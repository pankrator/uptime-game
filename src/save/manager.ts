import { type World } from '../ecs/world';
import { type SaveStorage, type SaveEnvelope } from './types';
import { serializeWorld } from './serialize';
import { deserializeWorld } from './deserialize';
import { migrateEnvelope } from './migrations';

// The only slot anything writes to today (D7/Non-goals: multiple named slots is a follow-up).
// 'autosave' is reserved here so callers can already ask `hasSave('autosave')` etc. once an
// autosave system (also a follow-up) starts writing to it.
export const MANUAL_SLOT = 'manual';
export const AUTOSAVE_SLOT = 'autosave';

export interface SaveManager {
  save(world: World, slot?: string): Promise<void>;
  // Resolves false (and leaves `world` untouched) if the slot is empty or the saved data is
  // corrupt/foreign JSON — see .plans/save-load.md D6: a bad save is "no save," never a thrown
  // exception the caller has to guard against.
  load(world: World, slot?: string): Promise<boolean>;
  hasSave(slot?: string): Promise<boolean>;
  deleteSave(slot?: string): Promise<void>;
}

function isEnvelopeShape(value: unknown): value is SaveEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { schemaVersion: unknown }).schemaVersion === 'number' &&
    Array.isArray((value as { entities: unknown }).entities)
  );
}

export function createSaveManager(storage: SaveStorage): SaveManager {
  return {
    async save(world, slot = MANUAL_SLOT) {
      const envelope = serializeWorld(world);
      await storage.write(slot, JSON.stringify(envelope));
    },

    async load(world, slot = MANUAL_SLOT) {
      const raw = await storage.read(slot);
      if (raw === null) return false;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.warn(`[save] corrupt save data in slot "${slot}" — ignoring`);
        return false;
      }

      if (!isEnvelopeShape(parsed)) {
        console.warn(`[save] malformed save envelope in slot "${slot}" — ignoring`);
        return false;
      }

      const envelope = migrateEnvelope(parsed) as SaveEnvelope;
      deserializeWorld(envelope, world);
      return true;
    },

    async hasSave(slot = MANUAL_SLOT) {
      return (await storage.read(slot)) !== null;
    },

    async deleteSave(slot = MANUAL_SLOT) {
      await storage.remove(slot);
    },
  };
}
