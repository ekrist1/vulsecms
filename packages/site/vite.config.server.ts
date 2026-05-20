import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  build: {
    ssr: true,
    outDir: 'dist/server',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'middleware/render': resolve(import.meta.dirname, 'src/server/middleware/render.ts'),
        'composables/useEntry': resolve(import.meta.dirname, 'src/composables/useEntry.ts'),
      },
      external: [/^@vulse\//, /^node:/],
      output: {
        entryFileNames: '[name].js',
      },
    },
    target: 'node22',
  },
});
