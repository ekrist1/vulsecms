import type { MiddlewareHandler } from 'hono';
import type { AuthVars } from '../types.js';

export function requireSuper(): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'auth_required' }, 401);
    if (!user.isSuper) return c.json({ error: 'forbidden' }, 403);
    await next();
  };
}
