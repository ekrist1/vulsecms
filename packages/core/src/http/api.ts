import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Blueprint } from '../blueprints/types.js';
import type { ContentService } from '../content/types.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { toMeta } from './meta.js';

export interface ApiDeps {
  blueprints: Map<string, Blueprint>;
  content: ContentService;
}

export function createApi({ blueprints, content }: ApiDeps): Hono {
  const app = new Hono();
  app.use('*', cors());

  app.onError((err, c) => {
    if (err instanceof ValidationError) {
      return c.json({ error: 'validation', issues: err.issues }, 422);
    }
    if (err instanceof NotFoundError) {
      return c.json({ error: 'not_found', message: err.message }, 404);
    }
    console.error(err);
    return c.json({ error: 'internal', message: err.message }, 500);
  });

  for (const handle of blueprints.keys()) {
    app.get(`/api/collections/${handle}`, async (c) => {
      const limit = Number(c.req.query('limit') ?? '100');
      const offset = Number(c.req.query('offset') ?? '0');
      return c.json(await content.list(handle, { limit, offset }));
    });

    app.get(`/api/collections/${handle}/:id`, async (c) => {
      const entry = await content.get(handle, c.req.param('id'));
      if (!entry) throw new NotFoundError(`entry not found`);
      return c.json(entry);
    });

    app.post(`/api/collections/${handle}`, async (c) => {
      const input = await c.req.json();
      const entry = await content.create(handle, input);
      return c.json(entry, 201);
    });

    app.patch(`/api/collections/${handle}/:id`, async (c) => {
      const input = await c.req.json();
      const entry = await content.update(handle, c.req.param('id'), input);
      return c.json(entry);
    });

    app.delete(`/api/collections/${handle}/:id`, async (c) => {
      await content.delete(handle, c.req.param('id'));
      return c.body(null, 204);
    });
  }

  app.get('/api/_meta/collections', (c) => c.json([...blueprints.values()].map(toMeta)));

  return app;
}
