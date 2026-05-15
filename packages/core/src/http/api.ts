import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Blueprint } from '../blueprints/types.js';
import type { ContentService } from '../content/types.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { toMeta } from './meta.js';
import {
  createBlueprint,
  updateBlueprint,
  deleteBlueprint,
} from '../blueprints/mutations.js';
import {
  BlueprintDefinitionSchema,
  BlueprintDefinitionWithRenamesSchema,
} from '../blueprints/definition.js';
import type { DatabaseAdapter } from '@vulse/db';

export interface ApiDeps {
  blueprints: Map<string, Blueprint>;
  content: ContentService;
  adapter: DatabaseAdapter;
}

export function createApi({ blueprints, content, adapter }: ApiDeps): Hono {
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

  // ---- Content routes (wildcard so admin mutations are reflected immediately) ----

  app.get('/api/collections/:handle', async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    const limit = Number(c.req.query('limit') ?? '100');
    const offset = Number(c.req.query('offset') ?? '0');
    return c.json(await content.list(handle, { limit, offset }));
  });

  app.get('/api/collections/:handle/:id', async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    const entry = await content.get(handle, c.req.param('id'));
    if (!entry) throw new NotFoundError('entry not found');
    return c.json(entry);
  });

  app.post('/api/collections/:handle', async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    const input = await c.req.json();
    const entry = await content.create(handle, input);
    return c.json(entry, 201);
  });

  app.patch('/api/collections/:handle/:id', async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    const input = await c.req.json();
    const entry = await content.update(handle, c.req.param('id'), input);
    return c.json(entry);
  });

  app.delete('/api/collections/:handle/:id', async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    await content.delete(handle, c.req.param('id'));
    return c.body(null, 204);
  });

  // ---- Blueprint routes ----

  app.get('/api/blueprints', async (c) => {
    const rows = await adapter.query<{ definition: string | null }>(
      'SELECT definition FROM collections WHERE definition IS NOT NULL ORDER BY created_at ASC',
    );
    return c.json(rows.map((r) => JSON.parse(r.definition!)));
  });

  app.get('/api/blueprints/:handle', async (c) => {
    const row = await adapter.queryOne<{ definition: string | null }>(
      'SELECT definition FROM collections WHERE handle = ?',
      [c.req.param('handle')],
    );
    if (!row || !row.definition) throw new NotFoundError('blueprint not found');
    return c.json(JSON.parse(row.definition));
  });

  app.post('/api/blueprints', async (c) => {
    const body = await c.req.json();
    const parsed = BlueprintDefinitionSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    const out = await createBlueprint(adapter, parsed.data);
    return c.json(out, 201);
  });

  app.patch('/api/blueprints/:handle', async (c) => {
    const body = await c.req.json();
    const parsed = BlueprintDefinitionWithRenamesSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    const out = await updateBlueprint(adapter, c.req.param('handle'), parsed.data);
    return c.json(out);
  });

  app.delete('/api/blueprints/:handle', async (c) => {
    await deleteBlueprint(adapter, c.req.param('handle'));
    return c.body(null, 204);
  });

  app.get('/api/_meta/collections', (c) => c.json([...blueprints.values()].map(toMeta)));

  return app;
}
