import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  ssr: {
    external: [
      '@libsql/client',
      '@vulse/auth',
      '@vulse/core',
      '@vulse/db',
      '@vulse/host',
      '@vulse/image',
      'sharp',
      'vue',
      'vue-router',
    ],
  },
  build: {
    ssr: true,
    outDir: resolve(__dirname, 'dist/server'),
    rollupOptions: {
      input: resolve(__dirname, 'server/server.ts'),
    },
    emptyOutDir: true,
  },
});
