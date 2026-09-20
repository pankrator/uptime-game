import { type SaveStorage } from './types';

const DEFAULT_PREFIX = 'uptime-game:save:';

// `write`/`read`/`remove` return Promises purely to match `SaveStorage`'s shape — the
// underlying localStorage calls are synchronous.
export function createLocalStorageSaveStorage(prefix = DEFAULT_PREFIX): SaveStorage {
  const keyFor = (slot: string) => `${prefix}${slot}`;

  return {
    async write(slot, data) {
      window.localStorage.setItem(keyFor(slot), data);
    },
    async read(slot) {
      return window.localStorage.getItem(keyFor(slot));
    },
    async list() {
      const slots: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key?.startsWith(prefix)) slots.push(key.slice(prefix.length));
      }
      return slots;
    },
    async remove(slot) {
      window.localStorage.removeItem(keyFor(slot));
    },
  };
}
