import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { vulseDevPlugin } from '../../packages/core/src/vite/plugin.ts';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    vulseDevPlugin({
      blueprintsDir: resolve(__dirname, 'blueprints'),
      database: { url: process.env.VULSE_DB_URL ?? 'file:./dev.db' },
    }),
  ],
});
