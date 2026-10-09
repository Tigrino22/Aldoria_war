import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://fiefs:fiefs@localhost:5432/fiefs_test',
      WORLD_SPEED: '1',
      MAP_SIZE: '50',
      BARBARIAN_VILLAGES: '5',
    },
  },
});
