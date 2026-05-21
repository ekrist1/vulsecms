import { projectLayouts, projectRoutes } from 'virtual:vulse-site-manifest';
import { createApp } from 'h3';
import { createSiteRenderer } from './server/middleware/render.js';
import type { SiteConfig, SiteServerDeps } from './types.js';

export interface CreateProjectSiteServerOptions {
  clientEntry?: string;
  stylesheet?: string;
  environment?: string;
}

export function createProjectSiteServer(
  deps: SiteServerDeps,
  options: CreateProjectSiteServerOptions = {},
) {
  const app = createApp();
  app.use(
    createSiteRenderer({
      ...deps,
      manifest: { routes: projectRoutes, hasProjectRoutes: projectRoutes.length > 0 },
      layouts: projectLayouts,
      render: options,
    }),
  );
  return app;
}

export type { SiteConfig, SiteServerDeps };
