export type EntityId = number;

export interface ComponentStore<T> {
  readonly map: Map<EntityId, T>;
}

// Every store ever created, regardless of which World(s) end up using it — components.ts
// creates one module-level singleton set of these for the whole process, shared by every
// World instance (see createWorld's own per-instance entity-id counter below). Consulted by
// resetAllComponentStores, which createWorld() itself calls.
const allComponentStores: ComponentStore<unknown>[] = [];

export function createComponentStore<T>(): ComponentStore<T> {
  const store: ComponentStore<T> = { map: new Map<EntityId, T>() };
  allComponentStores.push(store as ComponentStore<unknown>);
  return store;
}

// Called by createWorld() itself so every new World starts from empty stores regardless of
// what a previous World — a prior test, or eventually a prior game session — left behind at the
// same entity ids. Also exported directly for src/test/setup.ts's global beforeEach, which is
// now a harmless no-op belt-and-suspenders on top of it (each test still calls createWorld()
// itself via test-helpers.ts).
export function resetAllComponentStores(): void {
  for (const store of allComponentStores) {
    store.map.clear();
  }
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
// `World.createEntity`'s id counter and `entities` Set are the only state actually scoped to one
// World instance. Resetting every store on each call makes "component stores start empty" true
// by construction rather than merely documented and relying on src/test/setup.ts's global
// beforeEach hook — this is also what protects a future "quit to menu" feature (which would call
// createWorld() again mid-process) from silent data corruption: entity ids restarting at 1
// against maps still holding the previous game's components at those ids. The trade-off, stated
// plainly: this permanently rules out two live Worlds in one process.
export function createWorld(): World {
  resetAllComponentStores();
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
