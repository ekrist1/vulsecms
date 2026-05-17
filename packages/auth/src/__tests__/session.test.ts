import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionMiddleware } from '../middleware/session.js';
import type { AuthInstance } from '../instance.js';
import type { AuthVars } from '../types.js';

describe('sessionMiddleware', () => {
  let mockAuth: AuthInstance;

  beforeEach(() => {
    mockAuth = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth: { api: { getSession: vi.fn() } } as any,
      db: {} as never,
      client: {} as never,
      close: () => {},
    };
  });

  it('sets user=null when no session cookie', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockAuth.auth.api.getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const app = new Hono<{ Variables: AuthVars }>();
    app.use('*', sessionMiddleware(mockAuth));
    app.get('/test', (c) => c.json({ user: c.get('user') }));
    const res = await app.request('http://x/test');
    const body = (await res.json()) as { user: null };
    expect(body.user).toBeNull();
  });

  it('sets user when session is valid', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockAuth.auth.api.getSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: {
        id: 'u1', email: 'a@b.com', emailVerified: false, name: null, image: null,
        role: 'editor', isSuper: 1, createdAt: '2026', updatedAt: '2026',
      },
      session: { id: 's1', userId: 'u1', expiresAt: '2027', token: 'tok' },
    });
    const app = new Hono<{ Variables: AuthVars }>();
    app.use('*', sessionMiddleware(mockAuth));
    app.get('/test', (c) => c.json({ user: c.get('user'), session: c.get('session') }));
    const res = await app.request('http://x/test', {
      headers: { cookie: 'vulse_session=tok' },
    });
    const body = (await res.json()) as { user: { id: string; isSuper: boolean }; session: { id: string } };
    expect(body.user.id).toBe('u1');
    expect(body.user.isSuper).toBe(true);
    expect(body.session.id).toBe('s1');
  });
});
