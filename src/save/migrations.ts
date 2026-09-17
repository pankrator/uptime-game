// Envelope-level schema versioning — see .plans/save-load.md D6.
//
// Adding a component needs no migration: an old save simply lacks that key, which
// deserialize.ts already treats as "component absent," an ordinary legal ECS state.
// Removing a component needs no migration either: SAVE_COMPONENTS just stops looking for that
// key, and any leftover copy sitting in old JSON is ignored.
//
// A migration is only needed when a component's *shape* changes (a renamed/restructured
// field) in a way neither of the above covers. Bump CURRENT_SCHEMA_VERSION and add the step
// that transforms a raw envelope from the version below it up to the new one — e.g. for
// version 1 -> 2 renaming Wallet.money to Wallet.balance:
//
//   1: (raw) => {
//     for (const entity of raw.entities) {
//       const wallet = entity.components.wallet;
//       if (wallet) { wallet.balance = wallet.money; delete wallet.money; }
//     }
//     return raw;
//   }
//
// Each function migrates FROM its own key (the schemaVersion it's keyed under) to the next.
export const CURRENT_SCHEMA_VERSION = 1;

export const MIGRATIONS: Record<number, (raw: unknown) => unknown> = {};

// Applies every migration step from `raw`'s own schemaVersion up to CURRENT_SCHEMA_VERSION, in
// order. A no-op today since schemaVersion 1 is the only version that has ever existed.
export function migrateEnvelope(raw: { schemaVersion: number }): unknown {
  let data: unknown = raw;
  for (let version = raw.schemaVersion; version < CURRENT_SCHEMA_VERSION; version++) {
    const migrate = MIGRATIONS[version];
    if (migrate) data = migrate(data);
  }
  return data;
}
