import { describe, expect, it } from 'vitest';
import { LibsqlAdapter } from './libsql-adapter.js';

describe('LibsqlAdapter', () => {
  it('round-trips exec/query', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER)');
    await db.exec('INSERT INTO t (id, v) VALUES (?, ?)', ['a', 1]);
    const rows = await db.query<{ id: string; v: number }>('SELECT * FROM t');
    expect(rows).toEqual([{ id: 'a', v: 1 }]);
    await db.close();
  });

  it('queryOne returns null when missing', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
    const row = await db.queryOne('SELECT * FROM t WHERE id = ?', ['nope']);
    expect(row).toBeNull();
    await db.close();
  });

  it('transaction commits on success and rolls back on throw', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');

    await db.transaction(async (tx) => {
      await tx.exec('INSERT INTO t VALUES (?)', ['ok']);
    });
    expect(await db.query('SELECT * FROM t')).toHaveLength(1);

    await expect(
      db.transaction(async (tx) => {
        await tx.exec('INSERT INTO t VALUES (?)', ['bad']);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await db.query('SELECT * FROM t')).toHaveLength(1);

    await db.close();
  });

  it('transaction returns the user function value', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    const result = await db.transaction(async () => 42);
    expect(result).toBe(42);
    await db.close();
  });
});
