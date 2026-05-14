import { describe, expect, it } from 'vitest';
import { LibsqlAdapter } from './libsql-adapter.js';
import { runMigrations } from './migrate.js';
import { MIGRATIONS_DIR } from './index.js';

async function freshDb() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe('v1 schema', () => {
  it('creates all five tables plus the migrations table', async () => {
    const db = await freshDb();
    const rows = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        '_vulse_migrations',
        'collections',
        'entries',
        'navigation',
        'revisions',
        'settings',
      ]),
    );
    await db.close();
  });

  it('entries support parent/child + cascade on delete', async () => {
    const db = await freshDb();
    await db.exec(
      "INSERT INTO collections (handle, blueprint_hash) VALUES ('posts', 'h1')",
    );
    await db.exec(
      "INSERT INTO entries (id, collection_handle, content) VALUES ('p1', 'posts', '{}')",
    );
    await db.exec(
      "INSERT INTO entries (id, collection_handle, parent_id, content) VALUES ('c1', 'posts', 'p1', '{}')",
    );
    await db.exec("DELETE FROM entries WHERE id = 'p1'");
    const remaining = await db.query<{ id: string }>('SELECT id FROM entries');
    expect(remaining).toEqual([]);
    await db.close();
  });

  it('sort_order indexes return entries in order', async () => {
    const db = await freshDb();
    await db.exec(
      "INSERT INTO collections (handle, blueprint_hash) VALUES ('posts', 'h1')",
    );
    for (const [id, order] of [
      ['b', 2],
      ['a', 1],
      ['c', 3],
    ] as const) {
      await db.exec(
        "INSERT INTO entries (id, collection_handle, sort_order, content) VALUES (?, 'posts', ?, '{}')",
        [id, order],
      );
    }
    const ordered = await db.query<{ id: string }>(
      "SELECT id FROM entries WHERE collection_handle = 'posts' ORDER BY sort_order ASC",
    );
    expect(ordered.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    await db.close();
  });
});
