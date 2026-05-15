import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import type { Plugin, ViteDevServer } from 'vite';
import { loadBlueprints } from '../blueprints/load.js';
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
import { createContentService } from '../content/service.js';
import { createApi } from '../http/api.js';
import { blueprintEvents } from '../events.js';

export interface VulseDevOptions {
  blueprintsDir: string;
  database: ConstructorParameters<typeof LibsqlAdapter>[0];
}

export function vulseDevPlugin(opts: VulseDevOptions): Plugin {
  let adapter: LibsqlAdapter | null = null;

  return {
    name: 'vulse:dev',
    apply: 'serve',

    async configureServer(server: ViteDevServer) {
      adapter = new LibsqlAdapter(opts.database);
      await adapter.exec('PRAGMA foreign_keys = ON');
      await runMigrations(adapter, MIGRATIONS_DIR);
      await seedBlueprintsFromCode({ adapter, dir: opts.blueprintsDir });

      async function build() {
        const blueprints = await loadBlueprints({ adapter: adapter! });
        const content = createContentService(adapter!, blueprints);
        return createApi({ blueprints, content, adapter: adapter! });
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
