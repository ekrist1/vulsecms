import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGroup, deleteGroup, getGroup, listGroups, setPermissions, updateGroup } from '../services/groups.js';

describe('groups service', () => {
  let adapter: LibsqlAdapter;
  beforeEach(async () => {
    adapter = new LibsqlAdapter({ url: ':memory:' });
    await adapter.exec('PRAGMA foreign_keys = ON');
    await runMigrations(adapter, MIGRATIONS_DIR);
    await adapter.exec(
      `INSERT INTO collections (handle, blueprint_hash, definition) VALUES ('posts', '', '{"handle":"posts","label":"Posts","singleton":false,"fields":[]}')`,
    );
  });

  it('creates a group', async () => {
    const g = await createGroup(adapter, { handle: 'marketing', label: 'Marketing' });
    expect(g.handle).toBe('marketing');
  });

  it('lists groups', async () => {
    await createGroup(adapter, { handle: 'a', label: 'A' });
    await createGroup(adapter, { handle: 'b', label: 'B' });
    const list = await listGroups(adapter);
    expect(list.map((g) => g.handle).sort()).toEqual(['a', 'b']);
  });

  it('setPermissions replaces rows', async () => {
    const g = await createGroup(adapter, { handle: 'a', label: 'A' });
    await setPermissions(adapter, g.id, [
      { collectionHandle: 'posts', canRead: true, canCreate: true, canUpdate: false, canDelete: false },
    ]);
    const got = await getGroup(adapter, 'a');
    expect(got?.permissions).toEqual([
      { collectionHandle: 'posts', canRead: true, canCreate: true, canUpdate: false, canDelete: false },
    ]);
    // Replace with empty.
    await setPermissions(adapter, g.id, []);
    expect((await getGroup(adapter, 'a'))?.permissions).toEqual([]);
  });

  it('updates label', async () => {
    const g = await createGroup(adapter, { handle: 'a', label: 'A' });
    await updateGroup(adapter, g.id, { label: 'A2' });
    expect((await getGroup(adapter, 'a'))?.label).toBe('A2');
  });

  it('deletes group and cascades', async () => {
    const g = await createGroup(adapter, { handle: 'a', label: 'A' });
    await setPermissions(adapter, g.id, [
      { collectionHandle: 'posts', canRead: true, canCreate: false, canUpdate: false, canDelete: false },
    ]);
    await deleteGroup(adapter, g.id);
    expect(await getGroup(adapter, 'a')).toBeNull();
  });
});
