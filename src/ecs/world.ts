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
