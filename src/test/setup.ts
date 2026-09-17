// Runs before every test in every file (see vite.config.ts's test.setupFiles). Gives each test
// a clean slate of the ECS's module-level component stores — see resetAllComponentStores' own
// comment in ecs/world.ts for why that's necessary here but never an issue in the running game.
import { beforeEach } from 'vitest';
import { resetAllComponentStores } from '../ecs/world';

beforeEach(() => {
  resetAllComponentStores();
});
