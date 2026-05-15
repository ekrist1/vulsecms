import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApi, createContentService, loadBlueprints } from '@vulse/core';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { Hono } from 'hono';

const __dirname = dirname(fileURLToPath(import.meta.url));

const db = new LibsqlAdapter({ url: process.env.VULSE_DB_URL ?? 'file:./dev.db' });
await db.exec('PRAGMA foreign_keys = ON');
await runMigrations(db, MIGRATIONS_DIR);

const blueprints = await loadBlueprints(resolve(__dirname, '..', 'blueprints'), {
  adapter: db,
});
const content = createContentService(db, blueprints);
const api = createApi({ blueprints, content });

const app = new Hono();
app.route('/', api);
app.use('/*', serveStatic({ root: resolve(__dirname, '..', 'dist') }));

const port = Number(process.env.PORT ?? '3000');
serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(`Vulse listening on http://localhost:${port}`);
});
