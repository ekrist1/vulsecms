import type { MiddlewareHandler } from 'hono';
import type { AuthInstance } from '../instance.js';
import type { AuthUser, AuthSession, AuthVars } from '../types.js';

export function sessionMiddleware(authInstance: AuthInstance): MiddlewareHandler<{
  Variables: AuthVars;
}> {
  return async (c, next) => {
    const headers = c.req.raw.headers;
    const result = await authInstance.auth.api.getSession({ headers });
    if (!result) {
      c.set('user', null);
      c.set('session', null);
    } else {
      const u = result.user as Record<string, unknown>;
      const user: AuthUser = {
        id: String(u.id),
        email: String(u.email),
        emailVerified: Boolean(u.emailVerified),
        name: (u.name as string | null) ?? null,
        image: (u.image as string | null) ?? null,
        role: u.role as AuthUser['role'],
        isSuper: Number(u.isSuper) === 1 || u.isSuper === true,
        createdAt: String(u.createdAt),
        updatedAt: String(u.updatedAt),
      };
      const s = result.session as Record<string, unknown>;
      const session: AuthSession = {
        id: String(s.id),
        userId: String(s.userId),
        expiresAt: String(s.expiresAt),
        token: String(s.token),
      };
      c.set('user', user);
      c.set('session', session);
    }
    await next();
  };
}
