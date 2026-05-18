import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { createApp, createRouter, defineEventHandler, toWebHandler } from 'h3';
import { ulid } from 'ulid';
import { beforeEach, describe, expect, it } from 'vitest';
import { withPerm } from '../middleware/require-perm.js';
import type { AuthUser } from '../types.js';

function buildHandler(
  user: AuthUser | null,
  adapter: LibsqlAdapter,
  action: 'read' | 'create' | 'update' | 'delete',
) {
  const app = createApp();
  app.use(
    defineEventHandler((event) => {
      event.context.user = user;
      event.context.session = null;
    }),
  );
  const router = createRouter();
  const okHandler = defineEventHandler(() => ({ ok: true }));
  router.get('/api/collections/:handle', withPerm({ action, adapter }, okHandler));
  router.post('/api/collections/:handle', withPerm({ action, adapter }, okHandler));
  app.use(router.handler);
  return toWebHandler(app);
}

describe('requirePerm', () => {
  let adapter: LibsqlAdapter;

  beforeEach(async () => {
    adapter = new LibsqlAdapter({ url: ':memory:' });
    await adapter.exec('PRAGMA foreign_keys = ON');
    await runMigrations(adapter, MIGRATIONS_DIR);
    await adapter.exec(
      `INSERT INTO collections (handle, blueprint_hash, definition) VALUES ('posts', '', '{"handle":"posts","label":"Posts","singleton":false,"fields":[]}')`,
    );
  });

  it('anonymous read → 401', async () => {
    const res = await buildHandler(
      null,
      adapter,
      'read',
    )(new Request('http://x/api/collections/posts'));
    expect(res.status).toBe(401);
  });

  it('external_user write → 403', async () => {
    const u: AuthUser = {
      id: 'u',
      email: 'a',
      emailVerified: false,
      name: null,
      image: null,
      role: 'external_user',
      isSuper: false,
      createdAt: '',
      updatedAt: '',
    };
    const res = await buildHandler(
      u,
      adapter,
      'create',
    )(new Request('http://x/api/collections/posts', { method: 'POST' }));
    expect(res.status).toBe(403);
  });

  it('external_user read → 200 (entry-level protection handled elsewhere)', async () => {
    const u: AuthUser = {
      id: 'u',
      email: 'a',
      emailVerified: false,
      name: null,
      image: null,
      role: 'external_user',
      isSuper: false,
      createdAt: '',
      updatedAt: '',
    };
    const res = await buildHandler(
      u,
      adapter,
      'read',
    )(new Request('http://x/api/collections/posts'));
    expect(res.status).toBe(200);
  });

  it('super bypasses', async () => {
    const u: AuthUser = {
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
    const res = await buildHandler(
      u,
      adapter,
      'delete',
    )(new Request('http://x/api/collections/posts'));
    expect(res.status).toBe(200);
  });

  it('editor without group → 403', async () => {
    const userId = ulid();
    await adapter.exec(`INSERT INTO users (id, email, role, is_super) VALUES (?, ?, 'editor', 0)`, [
      userId,
      'e@x.com',
    ]);
    const u: AuthUser = {
      id: userId,
      email: 'e@x.com',
      emailVerified: false,
      name: null,
      image: null,
      role: 'editor',
      isSuper: false,
      createdAt: '',
      updatedAt: '',
    };
    const res = await buildHandler(
      u,
      adapter,
      'read',
    )(new Request('http://x/api/collections/posts'));
    expect(res.status).toBe(403);
  });

  it('editor with read perm → 200', async () => {
    const userId = ulid();
    const groupId = ulid();
    await adapter.exec(`INSERT INTO users (id, email, role, is_super) VALUES (?, ?, 'editor', 0)`, [
      userId,
      'e@x.com',
    ]);
    await adapter.exec(`INSERT INTO groups (id, handle, label) VALUES (?, 'g', 'G')`, [groupId]);
    await adapter.exec(`INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)`, [
      userId,
      groupId,
    ]);
    await adapter.exec(
      `INSERT INTO group_permissions (group_id, collection_handle, can_read) VALUES (?, 'posts', 1)`,
      [groupId],
    );
    const u: AuthUser = {
      id: userId,
      email: 'e@x.com',
      emailVerified: false,
      name: null,
      image: null,
      role: 'editor',
      isSuper: false,
      createdAt: '',
      updatedAt: '',
    };
    const res = await buildHandler(
      u,
      adapter,
      'read',
    )(new Request('http://x/api/collections/posts'));
    expect(res.status).toBe(200);
  });
});
