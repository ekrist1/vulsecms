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
        index: resolve(import.meta.dirname, 'src/index.ts'),
        'middleware/render': resolve(import.meta.dirname, 'src/server/middleware/render.ts'),
        'composables/useEntry': resolve(import.meta.dirname, 'src/composables/useEntry.ts'),
        'page-meta': resolve(import.meta.dirname, 'src/page-meta.ts'),
        virtual: resolve(import.meta.dirname, 'src/virtual.ts'),
        'project-server': resolve(import.meta.dirname, 'src/project-server.ts'),
        'vite/plugin': resolve(import.meta.dirname, 'src/vite/plugin.ts'),
      },
      external: [/^@vulse\/(?!site)/, /^node:/, /^virtual:vulse-site/],
      output: {
        entryFileNames: '[name].js',
      },
    },
    target: 'node22',
  },
});
