import type { DatabaseAdapter } from '@vulse/db';
import { Hono } from 'hono';
import { requireSuper } from '../middleware/require-super.js';
import { createUser, deleteUser, getUser, listUsers, updateUser } from '../services/users.js';
import type { AuthVars } from '../types.js';

export function usersRoute(adapter: DatabaseAdapter): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use('/api/users/*', requireSuper());
  app.use('/api/users', requireSuper());

  app.get('/api/users', async (c) => {
    const limit = Number(c.req.query('limit') ?? '50');
    const offset = Number(c.req.query('offset') ?? '0');
    const role = c.req.query('role') as 'editor' | 'external_user' | undefined;
    return c.json(await listUsers(adapter, { limit, offset, ...(role ? { role } : {}) }));
  });
  app.post('/api/users', async (c) => {
    const body = await c.req.json();
    return c.json(await createUser(adapter, body), 201);
  });
  app.get('/api/users/:id', async (c) => {
    const u = await getUser(adapter, c.req.param('id'));
    if (!u) return c.json({ error: 'not_found' }, 404);
    return c.json(u);
  });
  app.patch('/api/users/:id', async (c) => {
    const body = await c.req.json();
    return c.json(await updateUser(adapter, c.req.param('id'), body));
  });
  app.delete('/api/users/:id', async (c) => {
    await deleteUser(adapter, c.req.param('id'));
    return c.body(null, 204);
  });
  return app;
}
