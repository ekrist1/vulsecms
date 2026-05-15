import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { vulseDevPlugin } from '@vulse/core/vite';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    vue(),
    vulseDevPlugin({
      blueprintsDir: resolve(__dirname, 'blueprints'),
      database: { url: 'file:./dev.db' },
    }),
  ],
});
