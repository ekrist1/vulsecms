import { createApp, createRouter, defineEventHandler, toWebHandler } from 'h3';
import { describe, expect, it } from 'vitest';
import { requireSuper } from '../middleware/require-super.js';
import type { AuthUser } from '../types.js';

function buildHandler(user: AuthUser | null) {
  const app = createApp();
  app.use(
    defineEventHandler((event) => {
      event.context.user = user;
      event.context.session = null;
    }),
  );
  app.use(requireSuper());
  const router = createRouter();
  router.get(
    '/test',
    defineEventHandler(() => ({ ok: true })),
  );
  app.use(router.handler);
  return toWebHandler(app);
}

describe('requireSuper', () => {
  it('401 when no user', async () => {
    const res = await buildHandler(null)(new Request('http://x/test'));
    expect(res.status).toBe(401);
  });
  it('403 when not super', async () => {
    const user: AuthUser = {
      id: 'u',
      email: 'a',
      emailVerified: false,
      name: null,
      image: null,
      role: 'editor',
      isSuper: false,
      createdAt: '',
      updatedAt: '',
    };
    const res = await buildHandler(user)(new Request('http://x/test'));
    expect(res.status).toBe(403);
  });
  it('passes through for super', async () => {
    const user: AuthUser = {
      id: 'u',
      email: 'a',
      emailVerified: false,
      name: null,
      image: null,
      role: 'editor',
      isSuper: true,
      createdAt: '',
      updatedAt: '',
    };
    const res = await buildHandler(user)(new Request('http://x/test'));
    expect(res.status).toBe(200);
  });
});
