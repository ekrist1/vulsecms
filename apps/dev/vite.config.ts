import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { vulseDevPlugin } from '@vulse/core/vite';
import { databaseConfigFromEnv } from '@vulse/db';
import {
  type SiteRouteOverrides,
  createSiteServer,
  resolveSiteClientRoot,
} from '@vulse/site/server';
import { defineConfig } from 'vite';
import config from './vulse.config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: '/admin/',
  plugins: [
    vue(),
    tailwindcss(),
    vulseDevPlugin({
      blueprintsDir: resolve(__dirname, 'blueprints'),
      database: databaseConfigFromEnv(),
      site: {
        clientAssetsDir: resolveSiteClientRoot(),
        createApp: ({ blueprints, content, authInstance }) =>
          createSiteServer({
            blueprints,
            content,
            authInstance,
            routes: (config as { routes?: SiteRouteOverrides }).routes,
          }),
      },
    }),
  ],
});
