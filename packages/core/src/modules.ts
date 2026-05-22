import { type DatabaseAdapter, runMigrations } from '@vulse/db';
import type { Router } from 'h3';
import type { EventBus } from './bus.js';

export interface ModuleContext {
  db: DatabaseAdapter;
  bus: EventBus;
  // Provided by the host when it has an HTTP router available
  // (the dev/prod server passes the API router here).
  router?: Router;
}

export interface VulseModule {
  // Stable identifier — used to namespace migration filenames.
  name: string;
  // Directory of SQL migration files for this module. Filenames are stored
  // in _vulse_migrations as `${name}:${filename}` so plugins can ship
  // their own migration history without colliding with core.
  migrationsDir?: string;
  // Register HTTP handlers. Skipped when no router is provided.
  routes?: (router: Router, ctx: ModuleContext) => void | Promise<void>;
  // Subscribe to bus events.
  listeners?: (bus: EventBus, ctx: ModuleContext) => void | Promise<void>;
  // Last-chance hook for arbitrary one-time setup. Runs after migrations,
  // routes, and listeners have all been wired.
  setup?: (ctx: ModuleContext) => void | Promise<void>;
}

export async function loadModules(
  modules: readonly VulseModule[],
  ctx: ModuleContext,
): Promise<void> {
  const seen = new Set<string>();
  for (const m of modules) {
    if (seen.has(m.name)) {
      throw new Error(`duplicate module name: ${m.name}`);
    }
    seen.add(m.name);
  }

  for (const m of modules) {
    if (m.migrationsDir) {
      await runMigrations(ctx.db, m.migrationsDir, { module: m.name });
    }
    if (m.routes && ctx.router) {
      await m.routes(ctx.router, ctx);
    }
    if (m.listeners) {
      await m.listeners(ctx.bus, ctx);
    }
    if (m.setup) {
      await m.setup(ctx);
    }
  }
}
