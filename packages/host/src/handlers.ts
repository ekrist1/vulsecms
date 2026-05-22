import type { AuthInstance } from '@vulse/auth';
import {
  type EventBus,
  createApi,
  createContentService,
  createGlobalService,
  loadBlueprints,
  loadGlobalSets,
  loadSets,
} from '@vulse/core';
import type { DatabaseAdapter, DatabaseConfigSummary } from '@vulse/db';
import { probeMetadata } from '@vulse/image';
import { createProjectSiteServer } from '@vulse/site/project-server';
import type { SiteConfig, SiteRouteOverrides } from '@vulse/site/server';
import { type App, toNodeListener } from 'h3';

export interface BuildHandlersOptions {
  db: DatabaseAdapter;
  authInstance: AuthInstance;
  bus: EventBus;
  dbSummary?: DatabaseConfigSummary;
  previewSecret: string;
  imageSecret: string;
  imageCacheDir: string;
  // Optional site composition. When omitted, only the API handler is built.
  site?: {
    config: SiteConfig;
    routes?: SiteRouteOverrides;
  };
}

export interface BuiltHandlers {
  api: ReturnType<typeof toNodeListener>;
  site: ReturnType<typeof toNodeListener> | null;
  // Exposed so callers can mount additional sub-routers if they want to
  // wrap the API. Re-use is rare; most callers ignore this.
  apiApp: App;
}

/**
 * Compose the standard Vulse HTTP handlers (API + optional SSR site)
 * from the runtime services. This is the function user `server.ts` files
 * call inside their blueprint/sets reload watcher.
 *
 * Modules can register listeners that react to data changes before
 * this function rebuilds — wire them via `loadModules` before the first
 * call to buildHandlers.
 */
export async function buildHandlers(opts: BuildHandlersOptions): Promise<BuiltHandlers> {
  const sets = await loadSets({ adapter: opts.db });
  const blueprints = await loadBlueprints({ adapter: opts.db, sets });
  const content = createContentService(opts.db, blueprints);
  const globalSets = await loadGlobalSets({ adapter: opts.db });
  const globals = createGlobalService(opts.db, globalSets);

  const apiApp = createApi({
    blueprints,
    content,
    adapter: opts.db,
    authInstance: opts.authInstance,
    ...(opts.dbSummary ? { databaseSummary: opts.dbSummary } : {}),
    sets,
    previewSecret: opts.previewSecret,
    globals,
    imageSecret: opts.imageSecret,
    imageCacheDir: opts.imageCacheDir,
    probeImage: async (url) => {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return probeMetadata(buf);
    },
    onUserCreated: (user) =>
      opts.bus.emit('user.registered', {
        userId: user.id,
        email: user.email,
        name: user.name,
      }),
  });

  const siteApp = opts.site
    ? createProjectSiteServer({
        blueprints,
        content,
        globals,
        authInstance: opts.authInstance,
        previewSecret: opts.previewSecret,
        site: { ...opts.site.config, imageSecret: opts.imageSecret },
        ...(opts.site.routes ? { routes: opts.site.routes } : {}),
      })
    : null;

  return {
    api: toNodeListener(apiApp),
    site: siteApp ? toNodeListener(siteApp) : null,
    apiApp,
  };
}
