// Minimal Vulse server entry. This file lives in your project, not in
// node_modules — feel free to add custom routes, listeners, or middleware
// here. Upgrade Vulse with `pnpm up @vulse/*`; this file should rarely
// need to change.
//
// Vulse ships as a headless CMS: point your Astro / Next / SvelteKit
// frontend at the public HTTP API mounted under `/api/`. See
// `docs/frontend-foundation.md` for the integration recipe.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedSuperUser } from '@vulse/auth';
import {
  blueprintEvents,
  createEventBus,
  loadModules,
  seedBlueprintsFromCode,
  setsEvents,
} from '@vulse/core';
import { databaseConfigFromEnv } from '@vulse/db';
import {
  buildHandlers,
  createDefaultAuth,
  createDefaultMailer,
  createNodeServer,
  prepareDatabase,
  resolveSecrets,
} from '@vulse/host';
import { modules } from '../modules/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..', '..');
const adminStaticRoot = resolve(appRoot, 'dist');

const { db, summary: dbSummary } = await prepareDatabase(databaseConfigFromEnv());
await seedBlueprintsFromCode({ adapter: db, dir: resolve(appRoot, 'blueprints') });

const secrets = resolveSecrets({ appRoot });
const bus = createEventBus();
const baseUrl = process.env.VULSE_AUTH_BASE_URL ?? 'http://localhost:3000';

createDefaultMailer({
  bus,
  baseUrl,
  from: process.env.VULSE_MAIL_FROM ?? 'no-reply@example.com',
  ...(process.env.VULSE_SMTP_URL ? { smtpUrl: process.env.VULSE_SMTP_URL } : {}),
});

const authInstance = createDefaultAuth({
  client: db.client,
  bus,
  env: {
    authSecret: process.env.VULSE_AUTH_SECRET ?? 'dev-insecure-secret-change-me',
    baseUrl,
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

await loadModules(modules, { db, bus });

const handlerOpts = {
  db,
  authInstance,
  bus,
  dbSummary,
  previewSecret: secrets.previewSecret,
  imageSecret: secrets.imageSecret,
  imageCacheDir: secrets.imageCacheDir,
};
let listeners = await buildHandlers(handlerOpts);
const rebuild = async () => {
  listeners = await buildHandlers(handlerOpts);
};
blueprintEvents.on('change', rebuild);
setsEvents.on('change', rebuild);

const server = createNodeServer({
  getListeners: () => listeners,
  apiPrefixes: ['/api/', '/_vulse/img/'],
  staticRoots: [{ root: adminStaticRoot, base: '/admin', spaFallback: true }],
});

const port = Number(process.env.PORT ?? '3000');
server.listen(port, () => {
  console.log(`Vulse listening on http://localhost:${port}`);
});
