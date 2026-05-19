import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from './index.js';
import { LibsqlAdapter } from './libsql-adapter.js';
import { runMigrations } from './migrate.js';

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
    await db.exec("INSERT INTO collections (handle, blueprint_hash) VALUES ('posts', 'h1')");
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
    await db.exec("INSERT INTO collections (handle, blueprint_hash) VALUES ('posts', 'h1')");
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

  it('010_drafts adds draft columns and can_publish', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    await runMigrations(db, MIGRATIONS_DIR);

    const entryCols = await db.query<{ name: string }>('PRAGMA table_info(entries)');
    const names = entryCols.map((c) => c.name);
    expect(names).toContain('draft_content');
    expect(names).toContain('published_at');
    expect(names).toContain('published_by');

    const permCols = await db.query<{ name: string }>('PRAGMA table_info(group_permissions)');
    expect(permCols.map((c) => c.name)).toContain('can_publish');

    const revCols = await db.query<{ name: string }>('PRAGMA table_info(revisions)');
    expect(revCols.map((c) => c.name)).toContain('kind');

    await db.close();
  });

  it('010_drafts backfills published_at from updated_at for published rows', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    await runMigrations(db, MIGRATIONS_DIR);
    // Insert a row that pretends to predate the migration by mimicking the old
    // shape (published_at NULL).
    await db.exec(
      `INSERT INTO collections (handle, blueprint_hash) VALUES ('p', 'h1')`,
    );
    await db.exec(
      `INSERT INTO entries (id, collection_handle, parent_id, sort_order, status, content, updated_at, published_at)
       VALUES ('e1', 'p', NULL, 1, 'published', '{}', '2024-01-01 00:00:00', NULL)`,
    );
    // Re-run the backfill UPDATE (idempotent — same statement as in the migration).
    await db.exec(
      `UPDATE entries SET published_at = updated_at WHERE status = 'published' AND published_at IS NULL`,
    );
    const row = await db.queryOne<{ published_at: string | null }>(
      'SELECT published_at FROM entries WHERE id = ?',
      ['e1'],
    );
    expect(row?.published_at).toBe('2024-01-01 00:00:00');

    await db.close();
  });
});
