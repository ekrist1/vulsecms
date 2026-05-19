import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  build: {
    ssr: resolve(import.meta.dirname, 'src/server/middleware/render.ts'),
    outDir: 'dist/server',
    emptyOutDir: true,
    rollupOptions: {
      external: [/^@vulse\//, /^node:/],
      output: {
        entryFileNames: 'middleware/render.js',
      },
    },
    target: 'node22',
  },
});
