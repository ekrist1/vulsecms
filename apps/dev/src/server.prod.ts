import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createAuth, seedSuperUser } from '@vulse/auth';
import {
  blueprintEvents,
  createApi,
  createContentService,
  loadBlueprints,
  loadSets,
  seedBlueprintsFromCode,
  setsEvents,
} from '@vulse/core';
import {
  LibsqlAdapter,
  MIGRATIONS_DIR,
  databaseConfigFromEnv,
  describeConfig,
  runMigrations,
} from '@vulse/db';
import { Hono } from 'hono';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbConfig = databaseConfigFromEnv();
const dbSummary = describeConfig(dbConfig);
const dbDetails = [
  `driver=${dbSummary.driver}`,
  `scheme=${dbSummary.scheme}`,
  dbSummary.host ? `host=${dbSummary.host}` : null,
  dbSummary.embeddedReplica ? `replica-of=${dbSummary.syncUrlHost}` : null,
  dbSummary.encrypted ? 'encrypted=true' : null,
]
  .filter(Boolean)
  .join(' ');
console.log(`[vulse:db] ${dbDetails}`);
const db = new LibsqlAdapter(dbConfig);
await db.exec('PRAGMA foreign_keys = ON');
await runMigrations(db, MIGRATIONS_DIR);

const blueprintsDir = resolve(__dirname, '..', 'blueprints');
await seedBlueprintsFromCode({ adapter: db, dir: blueprintsDir });

const authInstance = createAuth({
  client: db.client,
  env: {
    authSecret: process.env.VULSE_AUTH_SECRET ?? 'dev-insecure-secret-do-not-use-in-prod',
    baseUrl: process.env.VULSE_AUTH_BASE_URL ?? 'http://localhost:3000',
    allowPublicSignup: (process.env.VULSE_ALLOW_PUBLIC_SIGNUP ?? 'true') !== 'false',
    smtpUrl: process.env.VULSE_SMTP_URL,
  },
});
await seedSuperUser({
  adapter: db,
  bootstrapEmail: process.env.VULSE_BOOTSTRAP_EMAIL,
  bootstrapPassword: process.env.VULSE_BOOTSTRAP_PASSWORD,
  isProd: process.env.NODE_ENV === 'production',
});

let sets = await loadSets({ adapter: db });

async function buildApp(): Promise<Hono> {
  const blueprints = await loadBlueprints({ adapter: db, sets });
  const content = createContentService(db, blueprints);
  const api = createApi({
    blueprints,
    content,
    adapter: db,
    authInstance,
    databaseSummary: dbSummary,
    sets,
  });
  const root = new Hono();
  root.route('/', api);
  root.use('/*', serveStatic({ root: resolve(__dirname, '..', 'dist') }));
  return root;
}

let app = await buildApp();
blueprintEvents.on('change', async () => {
  app = await buildApp();
});
setsEvents.on('change', async () => {
  sets = await loadSets({ adapter: db });
  app = await buildApp();
});

const port = Number(process.env.PORT ?? '3000');
serve({ fetch: (req) => app.fetch(req), port }, ({ port }) => {
  console.log(`Vulse listening on http://localhost:${port}`);
});
