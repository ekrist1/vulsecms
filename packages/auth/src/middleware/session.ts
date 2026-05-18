import { type EventHandler, defineEventHandler } from 'h3';
import type { AuthInstance } from '../instance.js';
import type { AuthSession, AuthUser } from '../types.js';

export function sessionMiddleware(authInstance: AuthInstance): EventHandler {
  return defineEventHandler(async (event) => {
    const result = await authInstance.auth.api.getSession({ headers: event.headers });
    if (!result) {
      event.context.user = null;
      event.context.session = null;
      return;
    }
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
    event.context.user = user;
    event.context.session = session;
  });
}
