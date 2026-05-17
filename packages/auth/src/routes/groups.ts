import type { DatabaseAdapter } from '@vulse/db';
import { Hono } from 'hono';
import { requireSuper } from '../middleware/require-super.js';
import {
  createGroup, deleteGroup, getGroup, listGroups, setPermissions, updateGroup,
} from '../services/groups.js';
import type { AuthVars } from '../types.js';

export function groupsRoute(adapter: DatabaseAdapter): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use('/api/groups/*', requireSuper());
  app.use('/api/groups', requireSuper());

  app.get('/api/groups', async (c) => c.json(await listGroups(adapter)));
  app.post('/api/groups', async (c) => {
    const body = await c.req.json();
    return c.json(await createGroup(adapter, body), 201);
  });
  app.get('/api/groups/:handle', async (c) => {
    const g = await getGroup(adapter, c.req.param('handle'));
    if (!g) return c.json({ error: 'not_found' }, 404);
    return c.json(g);
  });
  app.patch('/api/groups/:handle', async (c) => {
    const body = await c.req.json();
    const g = await getGroup(adapter, c.req.param('handle'));
    if (!g) return c.json({ error: 'not_found' }, 404);
    await updateGroup(adapter, g.id, body);
    return c.json(await getGroup(adapter, g.handle));
  });
  app.put('/api/groups/:handle/permissions', async (c) => {
    const body = (await c.req.json()) as { rows: Parameters<typeof setPermissions>[2] };
    const g = await getGroup(adapter, c.req.param('handle'));
    if (!g) return c.json({ error: 'not_found' }, 404);
    await setPermissions(adapter, g.id, body.rows);
    return c.json(await getGroup(adapter, g.handle));
  });
  app.delete('/api/groups/:handle', async (c) => {
    const g = await getGroup(adapter, c.req.param('handle'));
    if (!g) return c.json({ error: 'not_found' }, 404);
    await deleteGroup(adapter, g.id);
    return c.body(null, 204);
  });
  return app;
}
