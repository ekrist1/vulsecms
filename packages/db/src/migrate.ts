import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseAdapter } from './adapter.js';

export async function runMigrations(db: DatabaseAdapter, dir: string): Promise<void> {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS _vulse_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = await db.query<{ name: string }>('SELECT name FROM _vulse_migrations');
  const appliedSet = new Set(applied.map((r) => r.name));

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    await db.transaction(async (tx) => {
      for (const statement of splitStatements(sql)) {
        if (statement.trim()) await tx.exec(statement);
      }
      await tx.exec('INSERT INTO _vulse_migrations (name) VALUES (?)', [file]);
    });
  }
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}
