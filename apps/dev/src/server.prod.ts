import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  blueprintEvents,
  createApi,
  createContentService,
  loadBlueprints,
  seedBlueprintsFromCode,
} from '@vulse/core';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { Hono } from 'hono';

const __dirname = dirname(fileURLToPath(import.meta.url));

const db = new LibsqlAdapter({ url: process.env.VULSE_DB_URL ?? 'file:./dev.db' });
await db.exec('PRAGMA foreign_keys = ON');
await runMigrations(db, MIGRATIONS_DIR);

const blueprintsDir = resolve(__dirname, '..', 'blueprints');
await seedBlueprintsFromCode({ adapter: db, dir: blueprintsDir });

async function buildApp(): Promise<Hono> {
  const blueprints = await loadBlueprints({ adapter: db });
  const content = createContentService(db, blueprints);
  const api = createApi({ blueprints, content, adapter: db });
  const root = new Hono();
  root.route('/', api);
  root.use('/*', serveStatic({ root: resolve(__dirname, '..', 'dist') }));
  return root;
}

let app = await buildApp();
blueprintEvents.on('change', async () => {
  app = await buildApp();
});

const port = Number(process.env.PORT ?? '3000');
serve({ fetch: (req) => app.fetch(req), port }, ({ port }) => {
  console.log(`Vulse listening on http://localhost:${port}`);
});
