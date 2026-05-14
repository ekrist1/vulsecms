import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@vulse/core',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
