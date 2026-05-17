import type { DatabaseAdapter, Row } from './adapter.js';

export interface CopyOptions {
  /** Truncate matching tables on the target before inserting. */
  truncateTarget?: boolean;
  /** Maximum number of rows per INSERT batch. */
  batchSize?: number;
  /** Tables to skip (always includes sqlite_* and _vulse_migrations). */
  skipTables?: string[];
  /** Optional per-table progress reporter. */
  onProgress?: (event: CopyProgressEvent) => void;
}

export type CopyProgressEvent =
  | { type: 'table-start'; table: string }
  | { type: 'table-done'; table: string; rows: number }
  | { type: 'table-skipped'; table: string; reason: string };

export interface CopyResult {
  tables: { table: string; rows: number }[];
  totalRows: number;
}

const ALWAYS_SKIP = new Set(['_vulse_migrations']);

/**
 * Copy every user table from `source` to `target`, preserving row contents.
 * Assumes both databases share the same schema — typically the caller runs
 * migrations on the target first.
 */
export async function copyAllTables(
  source: DatabaseAdapter,
  target: DatabaseAdapter,
  opts: CopyOptions = {},
): Promise<CopyResult> {
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? 200, 1000));
  const skip = new Set([...ALWAYS_SKIP, ...(opts.skipTables ?? [])]);
  const tableRows = await source.query<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE 'libsql_%'
     ORDER BY name`,
  );

  const out: CopyResult = { tables: [], totalRows: 0 };

  for (const { name: table } of tableRows) {
    if (skip.has(table)) {
      opts.onProgress?.({ type: 'table-skipped', table, reason: 'in skip list' });
      continue;
    }
    opts.onProgress?.({ type: 'table-start', table });
    const rows = await source.query<Row>(`SELECT * FROM "${table}"`);
    if (rows.length === 0) {
      opts.onProgress?.({ type: 'table-done', table, rows: 0 });
      out.tables.push({ table, rows: 0 });
      continue;
    }
    if (opts.truncateTarget) {
      await target.exec(`DELETE FROM "${table}"`);
    }
    const columns = Object.keys(rows[0] as object);
    const quotedColumns = columns.map((c) => `"${c}"`).join(', ');
    const placeholders = `(${columns.map(() => '?').join(', ')})`;
    let copied = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const valuesSql = batch.map(() => placeholders).join(', ');
      const params: unknown[] = [];
      for (const row of batch) {
        for (const col of columns) params.push((row as Record<string, unknown>)[col] ?? null);
      }
      await target.exec(`INSERT INTO "${table}" (${quotedColumns}) VALUES ${valuesSql}`, params);
      copied += batch.length;
    }
    out.tables.push({ table, rows: copied });
    out.totalRows += copied;
    opts.onProgress?.({ type: 'table-done', table, rows: copied });
  }

  return out;
}
