import { sessionMiddleware, meRoute, usersRoute, groupsRoute, requirePerm, requireSuper, effectivePerms, type AuthInstance, type AuthVars } from '@vulse/auth';
import type { DatabaseAdapter } from '@vulse/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  BlueprintDefinitionSchema,
  BlueprintDefinitionWithRenamesSchema,
} from '../blueprints/definition.js';
import { createBlueprint, deleteBlueprint, updateBlueprint } from '../blueprints/mutations.js';
import type { Blueprint } from '../blueprints/types.js';
import type { ContentService } from '../content/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { assetRoutes } from '../assets/routes.js';
import { toMeta } from './meta.js';

export interface ApiDeps {
  blueprints: Map<string, Blueprint>;
  content: ContentService;
  adapter: DatabaseAdapter;
  authInstance: AuthInstance;
}

export function createApi({ blueprints, content, adapter, authInstance }: ApiDeps): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use('*', cors({ origin: (origin) => origin ?? '*', credentials: true }));
  app.use('*', sessionMiddleware(authInstance));

  // Mount our /api/auth/me sub-app BEFORE the Better Auth wildcard handler
  // so our custom route takes precedence over Better Auth's 404 fallback.
  app.route('/', meRoute(adapter));
  app.route('/', usersRoute(adapter));
  app.route('/', groupsRoute(adapter));
  app.route('/', assetRoutes(adapter));

  // Mount Better Auth's handler at /api/auth/*
  app.on(['GET', 'POST'], '/api/auth/*', (c) => authInstance.auth.handler(c.req.raw));

  app.onError((err, c) => {
    if (err instanceof ValidationError) {
      return c.json({ error: 'validation', issues: err.issues }, 422);
    }
    if (err instanceof NotFoundError) {
      return c.json({ error: 'not_found', message: err.message }, 404);
    }
    if (err instanceof ConflictError) {
      return c.json({ error: 'conflict', message: err.message }, 409);
    }
    console.error(err);
    return c.json({ error: 'internal', message: err.message }, 500);
  });

  // ---- Content routes (wildcard so admin mutations are reflected immediately) ----

  app.get('/api/collections/:handle', async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    const user = c.get('user');

    // Editors (non-super) need explicit read permission on this collection.
    if (user && user.role === 'editor' && !user.isSuper) {
      const perms = await effectivePerms(user, adapter);
      if (!perms.get(handle)?.has('read')) {
        return c.json({ error: 'forbidden' }, 403);
      }
    }

    const limit = Number(c.req.query('limit') ?? '100');
    const offset = Number(c.req.query('offset') ?? '0');
    const q = c.req.query('q') ?? undefined;
    const field = c.req.query('field') ?? undefined;
    return c.json(
      await content.list(handle, {
        limit,
        offset,
        ...(q ? { q } : {}),
        ...(field ? { field } : {}),
        includeProtected: user !== null, // signed-in users see all entries
      }),
    );
  });

  app.get('/api/collections/:handle/:id', async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    const user = c.get('user');

    if (user && user.role === 'editor' && !user.isSuper) {
      const perms = await effectivePerms(user, adapter);
      if (!perms.get(handle)?.has('read')) {
        return c.json({ error: 'forbidden' }, 403);
      }
    }

    const entry = await content.get(handle, c.req.param('id'));
    if (!entry) throw new NotFoundError('entry not found');
    if (entry.protected && !user) {
      return c.json({ error: 'auth_required' }, 401);
    }
    return c.json(entry);
  });

  app.post('/api/collections/:handle', requirePerm({ action: 'create', adapter }), async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    const input = await c.req.json();
    const entry = await content.create(handle, input);
    return c.json(entry, 201);
  });

  app.patch('/api/collections/:handle/:id', requirePerm({ action: 'update', adapter }), async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    const input = await c.req.json();
    const entry = await content.update(handle, c.req.param('id'), input);
    return c.json(entry);
  });

  app.delete('/api/collections/:handle/:id', requirePerm({ action: 'delete', adapter }), async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    await content.delete(handle, c.req.param('id'));
    return c.body(null, 204);
  });

  // ---- Blueprint routes ----

  app.get('/api/blueprints', async (c) => {
    if (!c.get('user')) return c.json({ error: 'auth_required' }, 401);
    const rows = await adapter.query<{ definition: string | null }>(
      'SELECT definition FROM collections WHERE definition IS NOT NULL ORDER BY created_at ASC',
    );
    return c.json(rows.map((r) => JSON.parse(r.definition!)));
  });

  app.get('/api/blueprints/:handle', async (c) => {
    if (!c.get('user')) return c.json({ error: 'auth_required' }, 401);
    const row = await adapter.queryOne<{ definition: string | null }>(
      'SELECT definition FROM collections WHERE handle = ?',
      [c.req.param('handle')],
    );
    if (!row || !row.definition) throw new NotFoundError('blueprint not found');
    return c.json(JSON.parse(row.definition));
  });

  app.post('/api/blueprints', requireSuper(), async (c) => {
    const body = await c.req.json();
    const parsed = BlueprintDefinitionSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    const out = await createBlueprint(adapter, parsed.data);
    return c.json(out, 201);
  });

  app.patch('/api/blueprints/:handle', requireSuper(), async (c) => {
    const body = await c.req.json();
    const parsed = BlueprintDefinitionWithRenamesSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    const out = await updateBlueprint(adapter, c.req.param('handle'), parsed.data);
    return c.json(out);
  });

  app.delete('/api/blueprints/:handle', requireSuper(), async (c) => {
    await deleteBlueprint(adapter, c.req.param('handle'));
    return c.body(null, 204);
  });

  app.get('/api/_meta/collections', (c) => {
    if (!c.get('user')) return c.json({ error: 'auth_required' }, 401);
    return c.json([...blueprints.values()].map(toMeta));
  });

  return app;
}
