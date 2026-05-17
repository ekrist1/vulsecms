import type { DatabaseAdapter } from '@vulse/db';
import type { MiddlewareHandler } from 'hono';
import { effectivePerms } from '../permissions.js';
import type { Action, AuthVars } from '../types.js';

export interface RequirePermOptions {
  action: Action;
  adapter: DatabaseAdapter;
}

export function requirePerm(opts: RequirePermOptions): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'auth_required' }, 401);

    if (user.role === 'external_user') {
      if (opts.action !== 'read') return c.json({ error: 'forbidden' }, 403);
      await next();
      return;
    }

    if (user.isSuper) {
      await next();
      return;
    }

    // When the middleware is mounted with `:handle*`, Hono names the param "handle*".
    // Fall back to that if the plain "handle" param is not present.
    const handle = c.req.param('handle') ?? (c.req.param() as Record<string, string>)['handle*'];
    if (!handle) return c.json({ error: 'bad_request' }, 400);

    let perms = c.get('perms');
    if (!perms) {
      perms = await effectivePerms(user, opts.adapter);
      c.set('perms', perms);
    }
    const allowed = perms.get(handle)?.has(opts.action) ?? false;
    if (!allowed) return c.json({ error: 'forbidden' }, 403);
    await next();
  };
}
