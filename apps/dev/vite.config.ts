import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { vulseDevPlugin } from '@vulse/core/vite';
import { databaseConfigFromEnv } from '@vulse/db';
import type { SiteConfig, SiteRouteOverrides } from '@vulse/site/server';
import { vulseSitePlugin } from '@vulse/site/vite';
import { createApp as createH3App, defineEventHandler } from 'h3';
import { defineConfig } from 'vite';
import config from './vulse.config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appConfig = config as { routes?: SiteRouteOverrides; site?: SiteConfig };
const configuredRoutes = appConfig.site?.routes ?? appConfig.routes;
const siteConfig: SiteConfig = {
  ...(appConfig.site ?? {}),
  ...(configuredRoutes ? { routes: configuredRoutes } : {}),
};
const siteDir = resolve(__dirname, appConfig.site?.frontend?.dir ?? 'site');
const siteProjectServerEntry = resolve(__dirname, '../../packages/site/src/project-server.ts');

export default defineConfig({
  base: '/admin/',
  plugins: [
    vue(),
    vulseSitePlugin({ dir: siteDir }),
    tailwindcss(),
    vulseDevPlugin({
      blueprintsDir: resolve(__dirname, 'blueprints'),
      database: databaseConfigFromEnv(),
      site: {
        createApp: async ({
          blueprints,
          content,
          authInstance,
          globals,
          previewSecret,
          server,
        }) => {
          const app = createH3App();
          app.use(
            defineEventHandler(async (event) => {
              const { createProjectSiteServer } = (await server.ssrLoadModule(
                siteProjectServerEntry,
              )) as typeof import('@vulse/site/project-server');
              const site = createProjectSiteServer(
                {
                  blueprints,
                  content,
                  globals,
                  authInstance,
                  previewSecret,
                  site: siteConfig,
                  ...(appConfig.routes ? { routes: appConfig.routes } : {}),
                },
                {
                  clientEntry: '/_vulse/site/entry-client.js',
                  stylesheet: `/@fs/${resolve(__dirname, '../../packages/site/src/style.css')}`,
                },
              );
              return site.handler(event);
            }),
          );
          return app;
        },
      },
    }),
  ],
  ssr: {
    noExternal: ['@vulse/site'],
  },
});
