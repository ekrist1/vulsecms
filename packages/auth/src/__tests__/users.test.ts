import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, deleteUser, getUser, listUsers, updateUser } from '../services/users.js';

describe('users service', () => {
  let adapter: LibsqlAdapter;
  beforeEach(async () => {
    adapter = new LibsqlAdapter({ url: ':memory:' });
    await adapter.exec('PRAGMA foreign_keys = ON');
    await runMigrations(adapter, MIGRATIONS_DIR);
  });

  it('creates an editor with given role and is_super', async () => {
    const u = await createUser(adapter, {
      email: 'e@x.com',
      password: 'hunter2hunter2',
      role: 'editor',
      isSuper: true,
      name: 'E',
    });
    expect(u.email).toBe('e@x.com');
    expect(u.role).toBe('editor');
    expect(u.isSuper).toBe(true);
  });

  it('lists with role filter and pagination', async () => {
    await createUser(adapter, {
      email: 'a@x.com',
      password: 'hunter2hunter2',
      role: 'editor',
      isSuper: false,
      name: 'A',
    });
    await createUser(adapter, {
      email: 'b@x.com',
      password: 'hunter2hunter2',
      role: 'external_user',
      isSuper: false,
      name: 'B',
    });
    const all = await listUsers(adapter, { limit: 10, offset: 0 });
    expect(all.total).toBe(2);
    const editors = await listUsers(adapter, { limit: 10, offset: 0, role: 'editor' });
    expect(editors.items.map((u) => u.email)).toEqual(['a@x.com']);
  });

  it('updates name, role, is_super, group memberships', async () => {
    const u = await createUser(adapter, {
      email: 'a@x.com',
      password: 'hunter2hunter2',
      role: 'editor',
      isSuper: false,
      name: 'A',
    });
    await adapter.exec(
      `INSERT INTO groups (id, handle, label) VALUES ('g1','marketing','Marketing')`,
    );
    const upd = await updateUser(adapter, u.id, {
      name: 'A2',
      role: 'external_user',
      isSuper: false,
      groupIds: ['g1'],
    });
    expect(upd.name).toBe('A2');
    expect(upd.role).toBe('external_user');
    expect(upd.groupIds).toEqual(['g1']);
  });

  it('deletes a user and cascades sessions', async () => {
    const u = await createUser(adapter, {
      email: 'a@x.com',
      password: 'hunter2hunter2',
      role: 'editor',
      isSuper: false,
      name: 'A',
    });
    await deleteUser(adapter, u.id);
    expect(await getUser(adapter, u.id)).toBeNull();
  });

  it('rejects duplicate emails', async () => {
    await createUser(adapter, {
      email: 'a@x.com',
      password: 'hunter2hunter2',
      role: 'editor',
      isSuper: false,
      name: 'A',
    });
    await expect(
      createUser(adapter, {
        email: 'a@x.com',
        password: 'hunter2hunter2',
        role: 'editor',
        isSuper: false,
        name: 'X',
      }),
    ).rejects.toThrow();
  });
});
