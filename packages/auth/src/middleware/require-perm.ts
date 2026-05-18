import type { DatabaseAdapter } from '@vulse/db';
import { type EventHandler, defineEventHandler, getRouterParam, setResponseStatus } from 'h3';
import { effectivePerms } from '../permissions.js';
import type { Action } from '../types.js';

export interface RequirePermOptions {
  action: Action;
  adapter: DatabaseAdapter;
}

async function check(
  event: Parameters<EventHandler>[0],
  opts: RequirePermOptions,
): Promise<{ ok: true } | { ok: false; status: 400 | 401 | 403; body: { error: string } }> {
  const user = event.context.user;
  if (!user) return { ok: false, status: 401, body: { error: 'auth_required' } };

  if (user.role === 'external_user') {
    if (opts.action !== 'read') return { ok: false, status: 403, body: { error: 'forbidden' } };
    return { ok: true };
  }

  if (user.isSuper) return { ok: true };

  const handle = getRouterParam(event, 'handle');
  if (!handle) return { ok: false, status: 400, body: { error: 'bad_request' } };

  let perms = event.context.perms;
  if (!perms) {
    perms = await effectivePerms(user, opts.adapter);
    event.context.perms = perms;
  }
  const allowed = perms.get(handle)?.has(opts.action) ?? false;
  if (!allowed) return { ok: false, status: 403, body: { error: 'forbidden' } };
  return { ok: true };
}

// Standalone middleware form. Note: route params (e.g. `:handle`) are only
// available when this middleware is mounted via a router. When mounted via
// `app.use('/api/collections/**', ...)`, `getRouterParam` returns undefined
// and the check falls through to its 'bad_request' branch — prefer the
// `withPerm(opts, handler)` form for per-route gating.
export function requirePerm(opts: RequirePermOptions): EventHandler {
  return defineEventHandler(async (event) => {
    const result = await check(event, opts);
    if (!result.ok) {
      setResponseStatus(event, result.status);
      return result.body;
    }
  });
}

// Per-route wrapping form: `router.post('/api/collections/:handle', withPerm({ ... }, handler))`.
export function withPerm(opts: RequirePermOptions, handler: EventHandler): EventHandler {
  return defineEventHandler(async (event) => {
    const result = await check(event, opts);
    if (!result.ok) {
      setResponseStatus(event, result.status);
      return result.body;
    }
    return await handler(event);
  });
}
