export type EntityId = number;

export interface ComponentStore<T> {
  readonly map: Map<EntityId, T>;
}

export function createComponentStore<T>(): ComponentStore<T> {
  return { map: new Map<EntityId, T>() };
}

export interface World {
  createEntity(): EntityId;
  destroyEntity(id: EntityId): void;
  // True if `id` was created by (and not yet destroyed on) THIS World — as opposed to merely
  // appearing as a key in some component store, which (see createWorld's comment below) could
  // in principle be another World's entity given the shared-storage design. save/serialize.ts
  // uses this to serialize only entities the passed-in World actually owns.
  hasEntity(id: EntityId): boolean;
  addComponent<T>(store: ComponentStore<T>, id: EntityId, value: T): void;
  getComponent<T>(store: ComponentStore<T>, id: EntityId): T | undefined;
  removeComponent<T>(store: ComponentStore<T>, id: EntityId): void;
  query(...stores: ComponentStore<unknown>[]): EntityId[];
}

// Component stores (components.ts) are created once and imported as module-level singletons —
// `World.createEntity`'s id counter and `entities` Set are the only state actually scoped to
// one World instance. The real app never notices (exactly one World is ever created per page
// load), but two Worlds live at once in the same process WILL collide: both id sequences start
// at 1 and both write into the same underlying Maps. src/save/test-utils.ts's
// clearAllComponentStores() is how the save/load tests work around this — see its comment.
export function createWorld(): World {
  let nextId = 1;
  const entities = new Set<EntityId>();
  const stores = new Set<ComponentStore<unknown>>();

  return {
    createEntity() {
      const id = nextId++;
      entities.add(id);
      return id;
    },
    destroyEntity(id: EntityId) {
      entities.delete(id);
      for (const store of stores) {
        store.map.delete(id);
      }
    },
    hasEntity(id: EntityId) {
      return entities.has(id);
    },
    addComponent<T>(store: ComponentStore<T>, id: EntityId, value: T) {
      stores.add(store as ComponentStore<unknown>);
      store.map.set(id, value);
    },
    getComponent<T>(store: ComponentStore<T>, id: EntityId) {
      return store.map.get(id);
    },
    removeComponent<T>(store: ComponentStore<T>, id: EntityId) {
      store.map.delete(id);
    },
    query(...stores: ComponentStore<unknown>[]) {
      if (stores.length === 0) return [];
      const [first, ...rest] = stores;
      const result: EntityId[] = [];
      for (const id of first.map.keys()) {
        if (rest.every((store) => store.map.has(id))) {
          result.push(id);
        }
      }
      return result;
    },
  };
}
