import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist/server',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/server.prod.ts'),
      output: { format: 'esm', entryFileNames: 'server.prod.js' },
    },
    target: 'node22',
  },
});
