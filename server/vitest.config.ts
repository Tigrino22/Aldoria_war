import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://aldoria:aldoria@localhost:5432/aldoria_test',
      WORLD_SPEED: '1',
      MAP_SIZE: '50',
      BARBARIAN_VILLAGES: '5',
      NPC_COUNT: '6',
      NPC_TRIBES: '0',
      NPC_TRIBE_MAX: '0',
      NPC_DAILY: '0',
    },
  },
});
