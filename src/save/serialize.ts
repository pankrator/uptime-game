import { type World, type EntityId } from '../ecs/world';
import { SAVE_COMPONENTS } from './registry';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import { type SaveEnvelope, type SerializedEntity } from './types';

// Entities are saved as an array; a component's reference to another entity (InstalledIn.rackId
// etc.) is remapped to that entity's INDEX in the array, not its live numeric id — ids aren't
// meaningful across a save/load boundary (see .plans/save-load.md D3). Only entities that carry
// at least one persistent component are included, in ascending id order (arbitrary but stable,
// which is all a round trip needs).
export function serializeWorld(world: World): SaveEnvelope {
  const entityIds = new Set<EntityId>();
  for (const entry of SAVE_COMPONENTS) {
    for (const id of entry.store.map.keys()) {
      // Component stores are module-level singletons (see world.ts's createWorld comment) —
      // this guard is what actually scopes serialization to the passed-in World's own
      // entities, rather than to whatever happens to be sitting in the shared Maps.
      if (world.hasEntity(id)) entityIds.add(id);
    }
  }
  const orderedIds = [...entityIds].sort((a, b) => a - b);

  const indexOf = new Map<EntityId, number>();
  orderedIds.forEach((id, index) => indexOf.set(id, index));
  // An id with no entry in this save (a reference to an entity that itself holds no persistent
  // component) has nothing sane to remap to; passing it through unchanged is a visible bug
  // rather than a silently wrong index. In practice every ref field here points at a rack or
  // machine, which always carries persistent components, so this branch is not expected to run.
  const remap = (id: EntityId): EntityId => indexOf.get(id) ?? id;

  const entities: SerializedEntity[] = orderedIds.map((id) => {
    const components: Record<string, unknown> = {};
    for (const entry of SAVE_COMPONENTS) {
      const value = entry.store.map.get(id);
      if (value === undefined) continue;
      components[entry.key] = entry.remapRefs ? entry.remapRefs(value, remap) : value;
    }
    return { components };
  });

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    savedAt: Date.now(),
    entities,
  };
}
