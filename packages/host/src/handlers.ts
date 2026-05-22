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
import { type App, toNodeListener } from 'h3';

export interface BuildHandlersOptions {
  db: DatabaseAdapter;
  authInstance: AuthInstance;
  bus: EventBus;
  dbSummary?: DatabaseConfigSummary;
  previewSecret: string;
  imageSecret: string;
  imageCacheDir: string;
}

export interface BuiltHandlers {
  api: ReturnType<typeof toNodeListener>;
  // Exposed so callers can mount additional sub-routers if they want to
  // wrap the API. Re-use is rare; most callers ignore this.
  apiApp: App;
}

/**
 * Compose the standard Vulse HTTP handlers (API) from the runtime
 * services. This is the function user `server.ts` files call inside
 * their blueprint/sets reload watcher.
 *
 * Vulse ships as a headless CMS: consumers point Astro / Next /
 * SvelteKit / etc. at the public HTTP API.
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

  return {
    api: toNodeListener(apiApp),
    apiApp,
  };
}
