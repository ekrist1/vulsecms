import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    cssCodeSplit: false,
    manifest: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/entry-client.ts'),
      output: {
        entryFileNames: 'entry-client.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
