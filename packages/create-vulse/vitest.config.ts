import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'create-vulse',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
