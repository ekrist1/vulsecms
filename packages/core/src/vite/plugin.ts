import { createAuth, seedSuperUser } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, describeConfig, runMigrations } from '@vulse/db';
import { toNodeListener } from 'h3';
import type { Plugin, ViteDevServer } from 'vite';
import { loadBlueprints } from '../blueprints/load.js';
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
import { createContentService } from '../content/service.js';
import { blueprintEvents } from '../events.js';
import { createApi } from '../http/api.js';
import { setsEvents } from '../sets/events.js';
import { loadSets } from '../sets/load.js';

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
      const databaseSummary = describeConfig(opts.database);
      await adapter.exec('PRAGMA foreign_keys = ON');
      await runMigrations(adapter, MIGRATIONS_DIR);
      await seedBlueprintsFromCode({ adapter, dir: opts.blueprintsDir });

      authInstance = createAuth({
        client: adapter.client,
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

      let sets = await loadSets({ adapter });

      async function build() {
        const blueprints = await loadBlueprints({ adapter: adapter!, sets });
        const content = createContentService(adapter!, blueprints);
        return createApi({
          blueprints,
          content,
          adapter: adapter!,
          authInstance: authInstance!,
          databaseSummary,
          sets,
        });
      }

      let listener = toNodeListener(await build());

      const onChange = async () => {
        listener = toNodeListener(await build());
        server.ws.send({ type: 'custom', event: 'vulse:blueprints-changed' });
      };
      blueprintEvents.on('change', onChange);

      const onSetsChange = async () => {
        sets = await loadSets({ adapter: adapter! });
        listener = toNodeListener(await build());
        server.ws.send({ type: 'custom', event: 'vulse:sets-changed' });
      };
      setsEvents.on('change', onSetsChange);

      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next();
        Promise.resolve(listener(req, res)).catch(next);
      });
    },

    async closeBundle() {
      authInstance?.close();
      await adapter?.close();
    },
  };
}
