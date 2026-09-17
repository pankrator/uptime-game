import { type World, type EntityId } from '../ecs/world';
import { SAVE_COMPONENTS } from './registry';
import { type SaveEnvelope } from './types';

// Inverse of serializeWorld: create one fresh entity per saved entity (via the world's normal
// createEntity(), in array order — see .plans/save-load.md D3, World has no "create with this
// id" escape hatch and doesn't need one), then hydrate each entity's persisted components,
// remapping any saved index back to the newly-created entity id it now corresponds to.
export function deserializeWorld(envelope: SaveEnvelope, world: World): void {
  const newIds: EntityId[] = envelope.entities.map(() => world.createEntity());
  const remap = (index: EntityId): EntityId => newIds[index] ?? index;

  envelope.entities.forEach((serialized, index) => {
    const id = newIds[index];
    for (const entry of SAVE_COMPONENTS) {
      const raw = serialized.components[entry.key];
      if (raw === undefined) continue;
      const value = entry.remapRefs ? entry.remapRefs(raw, remap) : raw;
      world.addComponent(entry.store, id, value);
    }
  });
}
