import { describe, expect, it } from 'vitest';
import { prepareDatabase } from './database.js';

describe('prepareDatabase', () => {
  it('opens an in-memory libsql adapter, enables foreign keys, runs core migrations', async () => {
    const { db, summary } = await prepareDatabase({ url: ':memory:' });

    const pragmaRow = await db.queryOne<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(pragmaRow?.foreign_keys).toBe(1);

    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = tables.map((t) => t.name);
    expect(names).toContain('_vulse_migrations');
    expect(names).toContain('collections');
    expect(names).toContain('entries');

    expect(summary.driver).toBeTruthy();
    await db.close();
  });
});
