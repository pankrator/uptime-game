import { type World } from '../ecs/world';
import { facilityTags, utilizations } from '../ecs/components';
import { defaultUtilization } from '../entities';
import { type SaveStorage, type SaveEnvelope } from './types';
import { serializeWorld } from './serialize';
import { deserializeWorld } from './deserialize';
import { migrateEnvelope } from './migrations';

// Five user-visible save slots (the landing screen's slot picker — see src/landing/index.ts)
// plus two reserved, non-user-visible slots: DEV_SLOT for the dev stress-preset button (so
// testing never overwrites a real save) and AUTOSAVE_SLOT for a future autosave system —
// reserved here so callers can already ask `hasSave(AUTOSAVE_SLOT)` etc. once something writes
// to it.
export const SAVE_SLOT_COUNT = 5;
export const SAVE_SLOT_IDS: readonly string[] = Array.from(
  { length: SAVE_SLOT_COUNT },
  (_, index) => `slot-${index + 1}`,
);
export const DEV_SLOT = 'dev-stress';
export const AUTOSAVE_SLOT = 'autosave';

export interface SaveSlotInfo {
  slot: string;
  occupied: boolean;
  // Only meaningful when occupied — Date.now() at the time that slot was last written.
  savedAt?: number;
}

export interface SaveManager {
  save(world: World, slot: string): Promise<void>;
  // Resolves false (and leaves `world` untouched) if the slot is empty or the saved data is
  // corrupt/foreign JSON — a bad save is "no save," never a thrown exception the caller has to
  // guard against.
  load(world: World, slot: string): Promise<boolean>;
  hasSave(slot: string): Promise<boolean>;
  deleteSave(slot: string): Promise<void>;
  // One read per slot, for the landing screen's slot picker (occupied/empty + last-saved
  // time) without needing a World to deserialize into.
  describeSlots(slots: readonly string[]): Promise<SaveSlotInfo[]>;
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
  // Shared by load/hasSave/describeSlots so "corrupt data reads as no save" is decided in
  // exactly one place, rather than load() and hasSave() ever quietly disagreeing about it.
  async function readEnvelope(slot: string): Promise<SaveEnvelope | null> {
    const raw = await storage.read(slot);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(`[save] corrupt save data in slot "${slot}" — ignoring`);
      return null;
    }

    if (!isEnvelopeShape(parsed)) {
      console.warn(`[save] malformed save envelope in slot "${slot}" — ignoring`);
      return null;
    }

    return migrateEnvelope(parsed) as SaveEnvelope;
  }

  return {
    async save(world, slot) {
      const envelope = serializeWorld(world);
      await storage.write(slot, JSON.stringify(envelope));
    },

    async load(world, slot) {
      const envelope = await readEnvelope(slot);
      if (!envelope) return false;
      deserializeWorld(envelope, world);

      // Utilization is deliberately transient — spawnFacility always seeds it for a fresh
      // game, but a load bypasses spawnFacility entirely, and every system that maintains
      // Utilization treats its absence as "not initialized" rather than "create it" (see
      // defaultUtilization's comment in entities/index.ts). Without this, a loaded game
      // stalls silently: no HUD top bar, no power/brownout resolution, no new offers.
      const facility = world.query(facilityTags)[0];
      if (facility !== undefined && !world.getComponent(utilizations, facility)) {
        world.addComponent(utilizations, facility, defaultUtilization());
      }

      return true;
    },

    async hasSave(slot) {
      return (await readEnvelope(slot)) !== null;
    },

    async deleteSave(slot) {
      await storage.remove(slot);
    },

    async describeSlots(slots) {
      const infos: SaveSlotInfo[] = [];
      for (const slot of slots) {
        const envelope = await readEnvelope(slot);
        infos.push({ slot, occupied: envelope !== null, savedAt: envelope?.savedAt });
      }
      return infos;
    },
  };
}
