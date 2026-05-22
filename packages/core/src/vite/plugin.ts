import { randomBytes } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { createAuth, seedSuperUser } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, describeConfig, runMigrations } from '@vulse/db';
import { type App, toNodeListener } from 'h3';
import type { Plugin, ViteDevServer } from 'vite';
import { loadBlueprints } from '../blueprints/load.js';
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
import type { Blueprint } from '../blueprints/types.js';
import { createEventBus } from '../bus.js';
import { createContentService } from '../content/service.js';
import type { ContentService } from '../content/types.js';
import { blueprintEvents } from '../events.js';
import { loadGlobalSets } from '../globals/load.js';
import { type GlobalService, createGlobalService } from '../globals/service.js';
import { createApi } from '../http/api.js';
import { createMailer, logTransport, smtpTransport } from '../mail/index.js';
import { setsEvents } from '../sets/events.js';
import { loadSets } from '../sets/load.js';

export interface VulseDevOptions {
  blueprintsDir: string;
  database: ConstructorParameters<typeof LibsqlAdapter>[0];
  site?: {
    base?: string;
    clientAssetsDir?: string;
    createApp: (deps: {
      blueprints: Map<string, Blueprint>;
      content: ContentService;
      authInstance: ReturnType<typeof createAuth>;
      globals: GlobalService;
      previewSecret: string;
      server: ViteDevServer;
    }) => App | Promise<App>;
  };
}

const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function resolvePreviewSecret(): string {
  const v = process.env.VULSE_PREVIEW_SECRET ?? process.env.VULSE_SESSION_SECRET;
  if (v) return v;
  const ephemeral = randomBytes(32).toString('hex');
  console.warn('[vulse] generated ephemeral VULSE_PREVIEW_SECRET (set one to survive restarts).');
  return ephemeral;
}

function serveAsset(root: string, base: string, reqUrl: string) {
  const pathname = decodeURIComponent(reqUrl.split('?')[0] ?? '/');
  if (!pathname.startsWith(base)) return null;
  const relativePath = pathname.slice(base.length).replace(/^\/+/, '').replace(/\.\./g, '');
  const candidate = new URL(relativePath, `file://${root.replace(/\/?$/, '/')}`);
  try {
    const stat = statSync(candidate);
    if (!stat.isFile()) return null;
    const ext = candidate.pathname.slice(candidate.pathname.lastIndexOf('.'));
    return { path: candidate, type: MIME_TYPES[ext] ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

function acceptsHtml(req: {
  headers: { accept?: string | string[] | undefined };
  method?: string | undefined;
  url?: string | undefined;
}) {
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') return false;
  const accept = Array.isArray(req.headers.accept)
    ? req.headers.accept.join(',')
    : (req.headers.accept ?? '');
  return accept.includes('text/html');
}

export function vulseDevPlugin(opts: VulseDevOptions): Plugin {
  let adapter: LibsqlAdapter | null = null;
  let authInstance: ReturnType<typeof createAuth> | null = null;

  return {
    name: 'vulse:dev',
    apply: 'serve',

    async configureServer(server: ViteDevServer) {
      adapter = new LibsqlAdapter(opts.database);
      const databaseSummary = describeConfig(opts.database);
      await adapter.exec('PRAGMA foreign_keys = ON');
      await runMigrations(adapter, MIGRATIONS_DIR);
      await seedBlueprintsFromCode({ adapter, dir: opts.blueprintsDir });
      const previewSecret = resolvePreviewSecret();

      const bus = createEventBus();
      const smtpUrl = process.env.VULSE_SMTP_URL;
      const mailFrom = process.env.VULSE_MAIL_FROM ?? 'no-reply@vulse.local';
      const mailer = createMailer({
        transport: smtpUrl ? smtpTransport(smtpUrl) : logTransport(process.stdout),
        from: mailFrom,
      });
      mailer.register('user.registered', {
        subject: (ctx) => `Welcome to Vulse, ${ctx.name ?? ctx.email}`,
        text: (ctx) => `Hi ${ctx.name ?? ctx.email},\n\nYour Vulse account is ready.\n`,
      });
      mailer.register('user.password_reset_requested', {
        subject: () => 'Reset your Vulse password',
        text: (ctx) =>
          `Hello ${ctx.name ?? ''},\n\nClick this link to reset your password:\n${ctx.resetUrl}\n`,
      });
      mailer.sendOnEvent(bus, 'user.registered', (p) => ({ to: p.email, context: p }));
      mailer.sendOnEvent(bus, 'user.password_reset_requested', (p) => ({
        to: p.email,
        context: p,
      }));

      authInstance = createAuth({
        client: adapter.client,
        env: {
          authSecret: process.env.VULSE_AUTH_SECRET ?? 'dev-insecure-secret-do-not-use-in-prod',
          baseUrl: process.env.VULSE_AUTH_BASE_URL ?? 'http://localhost:5173',
          allowPublicSignup: (process.env.VULSE_ALLOW_PUBLIC_SIGNUP ?? 'true') !== 'false',
          smtpUrl: process.env.VULSE_SMTP_URL,
        },
        callbacks: {
          onUserCreated: (user) =>
            bus.emit('user.registered', { userId: user.id, email: user.email, name: user.name }),
          sendResetEmail: (user, resetUrl) =>
            bus.emit('user.password_reset_requested', {
              userId: '',
              email: user.email,
              name: user.name,
              resetUrl,
            }),
        },
      });
      await seedSuperUser({
        adapter,
        bootstrapEmail: process.env.VULSE_BOOTSTRAP_EMAIL,
        bootstrapPassword: process.env.VULSE_BOOTSTRAP_PASSWORD,
        isProd: false,
      });

      let sets = await loadSets({ adapter });

      async function build() {
        const blueprints = await loadBlueprints({ adapter: adapter!, sets });
        const content = createContentService(adapter!, blueprints);
        const globalSets = await loadGlobalSets({ adapter: adapter! });
        const globals = createGlobalService(adapter!, globalSets);
        const api = createApi({
          blueprints,
          content,
          adapter: adapter!,
          authInstance: authInstance!,
          databaseSummary,
          sets,
          previewSecret,
          globals,
          onUserCreated: (user) =>
            bus.emit('user.registered', { userId: user.id, email: user.email, name: user.name }),
        });
        const site = opts.site
          ? await opts.site.createApp({
              blueprints,
              content,
              authInstance: authInstance!,
              globals,
              previewSecret,
              server,
            })
          : null;
        return {
          api: toNodeListener(api),
          site: site ? toNodeListener(site) : null,
        };
      }

      let listeners = await build();

      const onChange = async () => {
        listeners = await build();
        server.ws.send({ type: 'custom', event: 'vulse:blueprints-changed' });
      };
      blueprintEvents.on('change', onChange);

      const onSetsChange = async () => {
        sets = await loadSets({ adapter: adapter! });
        listeners = await build();
        server.ws.send({ type: 'custom', event: 'vulse:sets-changed' });
      };
      setsEvents.on('change', onSetsChange);

      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();

        const siteBase = opts.site?.base ?? '/_vulse/site/';
        if (opts.site?.clientAssetsDir && req.url.startsWith(siteBase)) {
          const file = serveAsset(opts.site.clientAssetsDir, siteBase, req.url);
          if (!file) return next();
          res.setHeader('content-type', file.type);
          createReadStream(file.path).pipe(res);
          return;
        }

        if (req.url.startsWith('/api/')) {
          Promise.resolve(listeners.api(req, res)).catch(next);
          return;
        }

        if (
          listeners.site &&
          !req.url.startsWith('/admin') &&
          !req.url.startsWith('/@') &&
          acceptsHtml(req)
        ) {
          Promise.resolve(listeners.site(req, res)).catch(next);
          return;
        }

        next();
      });
    },

    async closeBundle() {
      authInstance?.close();
      await adapter?.close();
    },
  };
}
