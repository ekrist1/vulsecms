import type { Config as LibsqlConfig } from '@libsql/client';
import {
  type DatabaseConfigSummary,
  LibsqlAdapter,
  MIGRATIONS_DIR,
  describeConfig,
  runMigrations,
} from '@vulse/db';

export type DatabaseConfig = LibsqlConfig;

export interface PreparedDatabase {
  db: LibsqlAdapter;
  summary: DatabaseConfigSummary;
}

/**
 * Open the libsql client, enable foreign keys, and run core migrations.
 *
 * Module migrations are run later by loadModules, not here — this helper
 * only handles the schema that ships inside @vulse/db.
 */
export async function prepareDatabase(config: DatabaseConfig): Promise<PreparedDatabase> {
  const summary = describeConfig(config);
  const db = new LibsqlAdapter(config);
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db, MIGRATIONS_DIR);
  return { db, summary };
}
