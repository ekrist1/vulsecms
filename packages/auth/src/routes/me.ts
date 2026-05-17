import type { DatabaseAdapter } from '@vulse/db';
import { Hono } from 'hono';
import { effectivePerms, permsToWire } from '../permissions.js';
import type { AuthVars } from '../types.js';

export function meRoute(adapter: DatabaseAdapter): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  app.get('/api/auth/me', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ user: null, perms: {} });
    const perms = await effectivePerms(user, adapter);
    return c.json({ user, perms: permsToWire(perms) });
  });
  return app;
}
