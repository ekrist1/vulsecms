import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { vulseSitePlugin } from '@vulse/site/vite';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(__dirname, 'site');

export default defineConfig({
  plugins: [vulseSitePlugin({ dir: siteDir }), vue()],
  ssr: {
    external: [
      '@libsql/client',
      '@vulse/auth',
      '@vulse/core',
      '@vulse/db',
      '@vulse/image',
      'sharp',
    ],
    noExternal: ['@vulse/site'],
  },
  build: {
    outDir: resolve(__dirname, 'dist/site'),
    emptyOutDir: true,
  },
});
