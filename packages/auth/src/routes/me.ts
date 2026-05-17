import { Hono } from 'hono';
import type { AuthVars } from '../types.js';

export function meRoute(): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  app.get('/api/auth/me', (c) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ user: null, perms: {} });
    }
    // Phase A stub — Phase B replaces with effectivePerms call.
    return c.json({ user, perms: {} });
  });
  return app;
}
