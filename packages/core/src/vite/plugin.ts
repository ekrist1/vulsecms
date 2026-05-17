import { createAuth, seedSuperUser } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import type { Plugin, ViteDevServer } from 'vite';
import { loadBlueprints } from '../blueprints/load.js';
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
import { createContentService } from '../content/service.js';
import { blueprintEvents } from '../events.js';
import { createApi } from '../http/api.js';

export interface VulseDevOptions {
  blueprintsDir: string;
  database: ConstructorParameters<typeof LibsqlAdapter>[0];
}

export function vulseDevPlugin(opts: VulseDevOptions): Plugin {
  let adapter: LibsqlAdapter | null = null;
  let authInstance: ReturnType<typeof createAuth> | null = null;

  return {
    name: 'vulse:dev',
    apply: 'serve',

    async configureServer(server: ViteDevServer) {
      adapter = new LibsqlAdapter(opts.database);
      await adapter.exec('PRAGMA foreign_keys = ON');
      await runMigrations(adapter, MIGRATIONS_DIR);
      await seedBlueprintsFromCode({ adapter, dir: opts.blueprintsDir });

      const dbUrl = typeof opts.database === 'string'
        ? opts.database
        : (opts.database.url ?? ':memory:');
      authInstance = createAuth({
        libsqlUrl: dbUrl,
        env: {
          authSecret: process.env.VULSE_AUTH_SECRET ?? 'dev-insecure-secret-do-not-use-in-prod',
          baseUrl: process.env.VULSE_AUTH_BASE_URL ?? 'http://localhost:5173',
          allowPublicSignup: (process.env.VULSE_ALLOW_PUBLIC_SIGNUP ?? 'true') !== 'false',
          smtpUrl: process.env.VULSE_SMTP_URL,
        },
      });
      await seedSuperUser({
        adapter,
        bootstrapEmail: process.env.VULSE_BOOTSTRAP_EMAIL,
        bootstrapPassword: process.env.VULSE_BOOTSTRAP_PASSWORD,
        isProd: false,
      });

      async function build() {
        const blueprints = await loadBlueprints({ adapter: adapter! });
        const content = createContentService(adapter!, blueprints);
        return createApi({ blueprints, content, adapter: adapter!, authInstance: authInstance! });
      }

      let app = await build();

      const onChange = async () => {
        app = await build();
        server.ws.send({ type: 'custom', event: 'vulse:blueprints-changed' });
      };
      blueprintEvents.on('change', onChange);

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next();
        try {
          const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') headers.set(k, v);
            else if (Array.isArray(v)) headers.set(k, v.join(','));
          }
          const method = req.method ?? 'GET';
          const hasBody = method !== 'GET' && method !== 'HEAD';
          const init: RequestInit = { method, headers };
          if (hasBody) {
            const buf = await readBody(req);
            init.body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as BodyInit;
          }
          const fetchReq = new Request(url.toString(), init);
          const fetchRes = await app.fetch(fetchReq);
          res.statusCode = fetchRes.status;
          fetchRes.headers.forEach((v, k) => res.setHeader(k, v));
          const buf = Buffer.from(await fetchRes.arrayBuffer());
          res.end(buf);
        } catch (err) {
          next(err as Error);
        }
      });
    },

    async closeBundle() {
      authInstance?.close();
      await adapter?.close();
    },
  };
}

import type { IncomingMessage } from 'node:http';
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
