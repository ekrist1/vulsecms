import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { ulid } from 'ulid';
import { beforeEach, describe, expect, it } from 'vitest';
import { effectivePerms } from '../permissions.js';
import type { AuthUser } from '../types.js';

function user(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: ulid(),
    email: 'u@x.com',
    emailVerified: false,
    name: null,
    image: null,
    role: 'editor',
    isSuper: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('effectivePerms', () => {
  let adapter: LibsqlAdapter;

  beforeEach(async () => {
    adapter = new LibsqlAdapter({ url: ':memory:' });
    await adapter.exec('PRAGMA foreign_keys = ON');
    await runMigrations(adapter, MIGRATIONS_DIR);
    await adapter.exec(
      `INSERT INTO collections (handle, blueprint_hash, definition) VALUES ('posts','','{"handle":"posts","label":"Posts","singleton":false,"fields":[]}')`,
    );
    await adapter.exec(
      `INSERT INTO collections (handle, blueprint_hash, definition) VALUES ('authors','','{"handle":"authors","label":"Authors","singleton":false,"fields":[]}')`,
    );
  });

  it('returns wildcard for super users', async () => {
    const perms = await effectivePerms(user({ isSuper: true }), adapter);
    expect(perms.get('*')?.has('delete')).toBe(true);
  });

  it('returns empty map for external_user', async () => {
    const perms = await effectivePerms(user({ role: 'external_user' }), adapter);
    expect(perms.size).toBe(0);
  });

  it('returns empty map for editor with no groups', async () => {
    const perms = await effectivePerms(user({ role: 'editor', isSuper: false }), adapter);
    expect(perms.size).toBe(0);
  });

  it('unions perms across multiple groups', async () => {
    const u = user({ role: 'editor', isSuper: false });
    await adapter.exec(`INSERT INTO users (id, email, role, is_super) VALUES (?, ?, 'editor', 0)`, [
      u.id,
      u.email,
    ]);
    const g1 = ulid();
    const g2 = ulid();
    await adapter.exec(
      `INSERT INTO groups (id, handle, label) VALUES (?, 'a', 'A'), (?, 'b', 'B')`,
      [g1, g2],
    );
    await adapter.exec(`INSERT INTO user_groups (user_id, group_id) VALUES (?, ?), (?, ?)`, [
      u.id,
      g1,
      u.id,
      g2,
    ]);
    await adapter.exec(
      `INSERT INTO group_permissions (group_id, collection_handle, can_read, can_create, can_update, can_delete)
       VALUES (?, 'posts', 1, 1, 0, 0), (?, 'posts', 0, 0, 1, 0), (?, 'authors', 1, 0, 0, 0)`,
      [g1, g2, g1],
    );
    const perms = await effectivePerms(u, adapter);
    expect([...(perms.get('posts') ?? [])].sort()).toEqual(['create', 'read', 'update']);
    expect([...(perms.get('authors') ?? [])]).toEqual(['read']);
  });

  it('surfaces can_publish=1 as the publish action', async () => {
    const u = user({ role: 'editor', isSuper: false });
    await adapter.exec(`INSERT INTO users (id, email, role, is_super) VALUES (?, ?, 'editor', 0)`, [
      u.id,
      u.email,
    ]);
    const g1 = ulid();
    await adapter.exec(
      `INSERT INTO groups (id, handle, label) VALUES (?, 'editors', 'Editors')`,
      [g1],
    );
    await adapter.exec(`INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)`, [u.id, g1]);
    await adapter.exec(
      `INSERT INTO group_permissions (group_id, collection_handle, can_read, can_create, can_update, can_delete, can_publish)
       VALUES (?, 'posts', 1, 1, 1, 0, 1)`,
      [g1],
    );
    const perms = await effectivePerms(u, adapter);
    expect(perms.get('posts')?.has('publish')).toBe(true);
  });

  it('superuser gets publish action implicitly', async () => {
    const perms = await effectivePerms(user({ isSuper: true }), adapter);
    expect(perms.get('*')?.has('publish')).toBe(true);
  });
});
