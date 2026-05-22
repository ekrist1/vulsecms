import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LibsqlAdapter } from './libsql-adapter.js';
import { runMigrations } from './migrate.js';

function tempMigrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vulse-mig-'));
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql);
  }
  return dir;
}

describe('runMigrations', () => {
  it('applies all .sql files in lexicographic order', async () => {
    const dir = tempMigrationsDir({
      '001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
      '002_b.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY);',
    });
    const db = new LibsqlAdapter({ url: ':memory:' });
    await runMigrations(db, dir);
    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_vulse_%' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(['a', 'b']);
    await db.close();
  });

  it('is idempotent — second run is a no-op', async () => {
    const dir = tempMigrationsDir({
      '001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
    });
    const db = new LibsqlAdapter({ url: ':memory:' });
    await runMigrations(db, dir);
    await runMigrations(db, dir);
    const applied = await db.query<{ name: string }>(
      'SELECT name FROM _vulse_migrations ORDER BY name',
    );
    expect(applied.map((r) => r.name)).toEqual(['001_a.sql']);
    await db.close();
  });

  it('namespaces filenames per module so two modules can share a filename', async () => {
    const dirA = tempMigrationsDir({
      '001_init.sql': 'CREATE TABLE plugin_a_t (id INTEGER PRIMARY KEY);',
    });
    const dirB = tempMigrationsDir({
      '001_init.sql': 'CREATE TABLE plugin_b_t (id INTEGER PRIMARY KEY);',
    });
    const db = new LibsqlAdapter({ url: ':memory:' });
    await runMigrations(db, dirA, { module: 'plugin_a' });
    await runMigrations(db, dirB, { module: 'plugin_b' });
    const applied = await db.query<{ name: string }>(
      'SELECT name FROM _vulse_migrations ORDER BY name',
    );
    expect(applied.map((r) => r.name)).toEqual(['plugin_a:001_init.sql', 'plugin_b:001_init.sql']);
    await db.close();
  });

  it('module-namespaced runs are idempotent independently of core', async () => {
    const coreDir = tempMigrationsDir({
      '001_core.sql': 'CREATE TABLE core_t (id INTEGER PRIMARY KEY);',
    });
    const modDir = tempMigrationsDir({
      '001_init.sql': 'CREATE TABLE mod_t (id INTEGER PRIMARY KEY);',
    });
    const db = new LibsqlAdapter({ url: ':memory:' });
    await runMigrations(db, coreDir);
    await runMigrations(db, modDir, { module: 'newsletter' });
    await runMigrations(db, modDir, { module: 'newsletter' });
    const applied = await db.query<{ name: string }>(
      'SELECT name FROM _vulse_migrations ORDER BY name',
    );
    expect(applied.map((r) => r.name)).toEqual(['001_core.sql', 'newsletter:001_init.sql']);
    await db.close();
  });

  it('rolls back when a migration fails', async () => {
    const dir = tempMigrationsDir({
      '001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
      '002_bad.sql': 'NOT VALID SQL;',
    });
    const db = new LibsqlAdapter({ url: ':memory:' });
    await expect(runMigrations(db, dir)).rejects.toThrow();
    const applied = await db.query<{ name: string }>('SELECT name FROM _vulse_migrations');
    expect(applied.map((r) => r.name)).toEqual(['001_a.sql']);
    await db.close();
  });
});
