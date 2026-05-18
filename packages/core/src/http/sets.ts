import type { AuthVars } from '@vulse/auth';
import { requireSuper } from '@vulse/auth';
import type { DatabaseAdapter } from '@vulse/db';
import { Hono } from 'hono';
import { ValidationError } from '../errors.js';
import { SetDefinitionSchema } from '../sets/definition.js';
import { createSet, deleteSet, getSet, listSets, updateSet } from '../sets/service.js';

export function setsRoute(adapter: DatabaseAdapter): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  // Reads: any signed-in user (admin's blueprint editor needs the list).
  app.get('/api/sets', async (c) => {
    if (!c.get('user')) return c.json({ error: 'auth_required' }, 401);
    return c.json(await listSets(adapter));
  });
  app.get('/api/sets/:handle', async (c) => {
    if (!c.get('user')) return c.json({ error: 'auth_required' }, 401);
    const out = await getSet(adapter, c.req.param('handle'));
    if (!out) return c.json({ error: 'not_found' }, 404);
    return c.json(out);
  });

  // Writes: super only.
  app.post('/api/sets', requireSuper(), async (c) => {
    const body = await c.req.json();
    const parsed = SetDefinitionSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    return c.json(await createSet(adapter, parsed.data), 201);
  });
  app.patch('/api/sets/:handle', requireSuper(), async (c) => {
    const body = await c.req.json();
    return c.json(await updateSet(adapter, c.req.param('handle'), body));
  });
  app.delete('/api/sets/:handle', requireSuper(), async (c) => {
    await deleteSet(adapter, c.req.param('handle'));
    return c.body(null, 204);
  });

  return app;
}
