import { randomBytes } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth, seedSuperUser } from '@vulse/auth';
import {
  blueprintEvents,
  createApi,
  createContentService,
  createGlobalService,
  loadBlueprints,
  loadGlobalSets,
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
import { type SiteConfig, type SiteRouteOverrides, createSiteServer } from '@vulse/site/server';
import { toNodeListener } from 'h3';
import config from '../vulse.config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..', '..');
const adminStaticRoot = resolve(__dirname, '..');
const siteClientEntry = fileURLToPath(import.meta.resolve('@vulse/site/client'));
const siteStaticRoot = dirname(siteClientEntry);
const appConfig = config as { routes?: SiteRouteOverrides; site?: SiteConfig };
const configuredRoutes = appConfig.site?.routes ?? appConfig.routes;
const siteConfig: SiteConfig = {
  ...(appConfig.site ?? {}),
  ...(configuredRoutes ? { routes: configuredRoutes } : {}),
};

function resolvePreviewSecret(): string {
  const v = process.env.VULSE_PREVIEW_SECRET ?? process.env.VULSE_SESSION_SECRET;
  if (v) return v;
  const ephemeral = randomBytes(32).toString('hex');
  console.warn('[vulse] generated ephemeral VULSE_PREVIEW_SECRET (set one to survive restarts).');
  return ephemeral;
}

const PREVIEW_SECRET = resolvePreviewSecret();
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

const blueprintsDir = resolve(appRoot, 'blueprints');
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

async function buildListeners() {
  const blueprints = await loadBlueprints({ adapter: db, sets });
  const content = createContentService(db, blueprints);
  const globalSets = await loadGlobalSets({ adapter: db });
  const globals = createGlobalService(db, globalSets);
  const api = createApi({
    blueprints,
    content,
    adapter: db,
    authInstance,
    databaseSummary: dbSummary,
    sets,
    previewSecret: PREVIEW_SECRET,
    globals,
  });
  const site = createSiteServer({
    blueprints,
    content,
    globals,
    authInstance,
    previewSecret: PREVIEW_SECRET,
    site: siteConfig,
    ...(appConfig.routes ? { routes: appConfig.routes } : {}),
  });
  return { api: toNodeListener(api), site: toNodeListener(site) };
}

let listeners = await buildListeners();
blueprintEvents.on('change', async () => {
  listeners = await buildListeners();
});
setsEvents.on('change', async () => {
  sets = await loadSets({ adapter: db });
  listeners = await buildListeners();
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

function serveStatic(
  root: string,
  reqUrl: string,
  opts: { base?: string; spaFallback?: boolean } = {},
): { path: string; type: string } | null {
  const pathname = decodeURIComponent(reqUrl.split('?')[0] ?? '/');
  if (opts.base && !pathname.startsWith(opts.base)) return null;
  const stripped = opts.base ? pathname.slice(opts.base.length) : pathname;
  const safePath = stripped.replace(/^\/+/, '').replace(/\.\./g, '');
  const candidate = safePath ? join(root, safePath) : join(root, 'index.html');
  try {
    const stat = statSync(candidate);
    if (stat.isFile()) {
      const ext = candidate.slice(candidate.lastIndexOf('.'));
      return { path: candidate, type: MIME_TYPES[ext] ?? 'application/octet-stream' };
    }
  } catch {
    // fall through
  }
  if (!opts.spaFallback) return null;

  try {
    const fallback = join(root, 'index.html');
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
    Promise.resolve(listeners.api(req, res)).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
      }
      res.end(JSON.stringify({ error: 'internal' }));
    });
    return;
  }

  const siteAsset = serveStatic(siteStaticRoot, req.url ?? '/', { base: '/_vulse/site/' });
  if (siteAsset) {
    res.setHeader('content-type', siteAsset.type);
    createReadStream(siteAsset.path).pipe(res);
    return;
  }

  const adminFile = serveStatic(adminStaticRoot, req.url ?? '/', {
    base: '/admin',
    spaFallback: true,
  });
  if (adminFile) {
    res.setHeader('content-type', adminFile.type);
    createReadStream(adminFile.path).pipe(res);
    return;
  }

  Promise.resolve(listeners.site(req, res)).catch((err) => {
    console.error(err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/html; charset=utf-8');
    }
    res.end('<!doctype html><h1>Internal server error</h1>');
  });
});

server.listen(port, () => {
  console.log(`Vulse listening on http://localhost:${port}`);
});
