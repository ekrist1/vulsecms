import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { vulseSitePlugin } from '@vulse/site/vite';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(__dirname, 'site');

export default defineConfig({
  plugins: [vulseSitePlugin({ dir: siteDir }), vue()],
  build: {
    outDir: 'dist/site',
    emptyOutDir: true,
    cssCodeSplit: false,
    manifest: true,
    rollupOptions: {
      input: '@vulse/site/project-client',
      output: {
        entryFileNames: 'entry-client.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  ssr: {
    noExternal: ['@vulse/site'],
  },
});
