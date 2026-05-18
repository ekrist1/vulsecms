import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { toNodeListener } from 'h3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(__dirname, '..', 'dist');

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

async function buildListener() {
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
  return toNodeListener(api);
}

let listener = await buildListener();
blueprintEvents.on('change', async () => {
  listener = await buildListener();
});
setsEvents.on('change', async () => {
  sets = await loadSets({ adapter: db });
  listener = await buildListener();
});

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function serveStatic(reqUrl: string): { path: string; type: string } | null {
  const pathname = decodeURIComponent(reqUrl.split('?')[0] ?? '/');
  const safePath = pathname.replace(/^\/+/, '').replace(/\.\./g, '');
  const candidate = safePath ? join(staticRoot, safePath) : join(staticRoot, 'index.html');
  try {
    const stat = statSync(candidate);
    if (stat.isFile()) {
      const ext = candidate.slice(candidate.lastIndexOf('.'));
      return { path: candidate, type: MIME_TYPES[ext] ?? 'application/octet-stream' };
    }
  } catch {
    // fall through
  }
  // SPA fallback
  try {
    const fallback = join(staticRoot, 'index.html');
    const stat = statSync(fallback);
    if (stat.isFile()) return { path: fallback, type: 'text/html; charset=utf-8' };
  } catch {
    // fall through
  }
  return null;
}

const port = Number(process.env.PORT ?? '3000');
const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    Promise.resolve(listener(req, res)).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
      }
      res.end(JSON.stringify({ error: 'internal' }));
    });
    return;
  }
  const file = serveStatic(req.url ?? '/');
  if (!file) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader('content-type', file.type);
  createReadStream(file.path).pipe(res);
});

server.listen(port, () => {
  console.log(`Vulse listening on http://localhost:${port}`);
});
