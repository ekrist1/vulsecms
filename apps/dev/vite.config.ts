import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { vulseDevPlugin } from '@vulse/core/vite';
import { databaseConfigFromEnv } from '@vulse/db';
import {
  type SiteConfig,
  type SiteRouteOverrides,
  createSiteServer,
  resolveSiteClientRoot,
} from '@vulse/site/server';
import { defineConfig } from 'vite';
import config from './vulse.config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appConfig = config as { routes?: SiteRouteOverrides; site?: SiteConfig };
const configuredRoutes = appConfig.site?.routes ?? appConfig.routes;
const siteConfig: SiteConfig = {
  ...(appConfig.site ?? {}),
  ...(configuredRoutes ? { routes: configuredRoutes } : {}),
};

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
            site: siteConfig,
            ...(appConfig.routes ? { routes: appConfig.routes } : {}),
          }),
      },
    }),
  ],
});
