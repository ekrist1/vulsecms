import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@vulse/auth',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
