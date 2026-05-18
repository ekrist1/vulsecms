import type { DatabaseAdapter } from '@vulse/db';
import { type Router, createRouter, defineEventHandler } from 'h3';
import { effectivePerms, permsToWire } from '../permissions.js';

export function meRoute(adapter: DatabaseAdapter): Router {
  const router = createRouter();
  router.get(
    '/api/auth/me',
    defineEventHandler(async (event) => {
      const user = event.context.user;
      if (!user) return { user: null, perms: {} };
      const perms = await effectivePerms(user, adapter);
      return { user, perms: permsToWire(perms) };
    }),
  );
  return router;
}
