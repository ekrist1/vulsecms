import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requireSuper } from '../middleware/require-super.js';
import type { AuthUser, AuthVars } from '../types.js';

function setupApp(user: AuthUser | null) {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use('*', async (c, next) => { c.set('user', user); c.set('session', null); await next(); });
  app.use('*', requireSuper());
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('requireSuper', () => {
  it('401 when no user', async () => {
    const res = await setupApp(null).request('http://x/test');
    expect(res.status).toBe(401);
  });
  it('403 when not super', async () => {
    const user: AuthUser = { id: 'u', email: 'a', emailVerified: false, name: null, image: null, role: 'editor', isSuper: false, createdAt: '', updatedAt: '' };
    const res = await setupApp(user).request('http://x/test');
    expect(res.status).toBe(403);
  });
  it('passes through for super', async () => {
    const user: AuthUser = { id: 'u', email: 'a', emailVerified: false, name: null, image: null, role: 'editor', isSuper: true, createdAt: '', updatedAt: '' };
    const res = await setupApp(user).request('http://x/test');
    expect(res.status).toBe(200);
  });
});
