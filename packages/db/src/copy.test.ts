import { describe, expect, it } from 'vitest';
import { copyAllTables } from './copy.js';
import { LibsqlAdapter } from './libsql-adapter.js';

async function makeSchema(db: LibsqlAdapter) {
  await db.exec(`CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)`);
  await db.exec(`CREATE TABLE tags (id INTEGER PRIMARY KEY, label TEXT NOT NULL)`);
  await db.exec(
    `CREATE TABLE _vulse_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT '2020-01-01')`,
  );
}

describe('copyAllTables', () => {
  it('copies rows from source to a matching target schema', async () => {
    const src = new LibsqlAdapter({ url: ':memory:' });
    const dst = new LibsqlAdapter({ url: ':memory:' });
    await makeSchema(src);
    await makeSchema(dst);

    await src.exec(`INSERT INTO notes (id, body) VALUES (?, ?), (?, ?)`, ['1', 'hi', '2', 'yo']);
    await src.exec(`INSERT INTO tags (id, label) VALUES (?, ?)`, [1, 'red']);
    await src.exec(`INSERT INTO _vulse_migrations (name) VALUES (?)`, ['001.sql']);

    const result = await copyAllTables(src, dst);
    expect(result.totalRows).toBe(3);
    expect(result.tables.map((t) => t.table).sort()).toEqual(['notes', 'tags']);

    const notes = await dst.query('SELECT id, body FROM notes ORDER BY id');
    expect(notes).toEqual([
      { id: '1', body: 'hi' },
      { id: '2', body: 'yo' },
    ]);
    expect((await dst.query('SELECT COUNT(*) AS c FROM tags'))[0]).toEqual({ c: 1 });
    // _vulse_migrations was skipped on target — should still be empty
    expect((await dst.query('SELECT COUNT(*) AS c FROM _vulse_migrations'))[0]).toEqual({ c: 0 });

    await src.close();
    await dst.close();
  });

  it('truncates the target table when truncateTarget is set', async () => {
    const src = new LibsqlAdapter({ url: ':memory:' });
    const dst = new LibsqlAdapter({ url: ':memory:' });
    await makeSchema(src);
    await makeSchema(dst);
    await src.exec(`INSERT INTO notes (id, body) VALUES ('a', 'src')`);
    await dst.exec(`INSERT INTO notes (id, body) VALUES ('z', 'pre-existing')`);

    await copyAllTables(src, dst, { truncateTarget: true });
    const rows = await dst.query('SELECT id, body FROM notes ORDER BY id');
    expect(rows).toEqual([{ id: 'a', body: 'src' }]);

    await src.close();
    await dst.close();
  });

  it('emits progress events for each table', async () => {
    const src = new LibsqlAdapter({ url: ':memory:' });
    const dst = new LibsqlAdapter({ url: ':memory:' });
    await makeSchema(src);
    await makeSchema(dst);
    await src.exec(`INSERT INTO notes (id, body) VALUES ('1', 'x')`);

    const events: string[] = [];
    await copyAllTables(src, dst, {
      onProgress: (e) => events.push(`${e.type}:${e.table}`),
    });
    expect(events).toContain('table-start:notes');
    expect(events).toContain('table-done:notes');
    expect(events.some((e) => e.startsWith('table-skipped:_vulse_migrations'))).toBe(true);

    await src.close();
    await dst.close();
  });
});
