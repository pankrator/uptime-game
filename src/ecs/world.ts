export type EntityId = number;

export interface ComponentStore<T> {
  readonly map: Map<EntityId, T>;
}

// Every store ever created, regardless of which World(s) end up using it — components.ts
// creates one module-level singleton set of these for the whole process, shared by every
// World instance (see createWorld's own per-instance entity-id counter below). Only consulted
// by resetAllComponentStores, which nothing in the running game calls.
const allComponentStores: ComponentStore<unknown>[] = [];

export function createComponentStore<T>(): ComponentStore<T> {
  const store: ComponentStore<T> = { map: new Map<EntityId, T>() };
  allComponentStores.push(store as ComponentStore<unknown>);
  return store;
}

// Test-only escape hatch. The real game creates exactly one World per page load, so component
// stores being module-level singletons (not owned per-World) never matters there. A test suite
// that calls createWorld() many times in one process is not that world: entity ids restart at 1
// each call, but the singleton stores from components.ts keep every previous test's entries —
// so a fresh World can collide with, and read, stale components an earlier test left behind at
// the same numeric id. Call this between tests (see src/test/setup.ts) to give each one a clean
// slate, equivalent to a fresh page load.
export function resetAllComponentStores(): void {
  for (const store of allComponentStores) {
    store.map.clear();
  }
}

export interface World {
  createEntity(): EntityId;
  destroyEntity(id: EntityId): void;
  addComponent<T>(store: ComponentStore<T>, id: EntityId, value: T): void;
  getComponent<T>(store: ComponentStore<T>, id: EntityId): T | undefined;
  removeComponent<T>(store: ComponentStore<T>, id: EntityId): void;
  query(...stores: ComponentStore<unknown>[]): EntityId[];
}

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
