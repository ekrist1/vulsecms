import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@vulse/db',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
