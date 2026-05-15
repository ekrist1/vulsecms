import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    name: '@vulse/renderer',
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
  },
});
