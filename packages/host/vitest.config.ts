import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@vulse/host',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
