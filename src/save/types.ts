// Save/load module — see .plans/save-load.md.

// A save "slot" is just a string key. localStorage today (local-storage.ts); a future
// backend adapter (.plans/save-load.md D1) implements the exact same interface against an
// HTTP API, so nothing above this line ever changes.
export interface SaveStorage {
  write(slot: string, data: string): Promise<void>;
  read(slot: string): Promise<string | null>;
  list(): Promise<string[]>;
  remove(slot: string): Promise<void>;
}

// One entity's persisted components, keyed by the component registry's stable `key` (see
// registry.ts) — never by the entity's own id, which is not preserved across a save (D3).
export interface SerializedEntity {
  components: Record<string, unknown>;
}

export interface SaveEnvelope {
  schemaVersion: number;
  savedAt: number;
  entities: SerializedEntity[];
}
