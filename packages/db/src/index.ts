import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type { DatabaseAdapter, Row } from './adapter.js';
export { LibsqlAdapter } from './libsql-adapter.js';
export { runMigrations } from './migrate.js';
export {
  databaseConfigFromEnv,
  describeConfig,
  type DatabaseConfigSummary,
} from './config.js';
export {
  copyAllTables,
  type CopyOptions,
  type CopyResult,
  type CopyProgressEvent,
} from './copy.js';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, '..', 'migrations');
