import type { DatabaseAdapter } from '@vulse/db';
import { ulid } from 'ulid';
import type { RevisionDTO, RevisionSummary } from './types.js';

interface RevisionRow {
  id: string;
  entry_id: string;
  revision_number: number;
  content: string;
  created_at: string;
  created_by: string | null;
}

function rowToSummary(r: RevisionRow): RevisionSummary {
  return {
    id: r.id,
    entryId: r.entry_id,
    revisionNumber: r.revision_number,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

function rowToDTO(r: RevisionRow): RevisionDTO {
  return {
    ...rowToSummary(r),
    content: JSON.parse(r.content),
  };
}

export async function snapshotRevision(
  adapter: DatabaseAdapter,
  entryId: string,
  content: Record<string, unknown>,
  actor: { userId: string } | null = null,
): Promise<RevisionDTO> {
  const maxRow = await adapter.queryOne<{ m: number | null }>(
    'SELECT MAX(revision_number) AS m FROM revisions WHERE entry_id = ?',
    [entryId],
  );
  const next = (maxRow?.m ?? 0) + 1;
  const id = ulid();
  await adapter.exec(
    `INSERT INTO revisions (id, entry_id, revision_number, content, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [id, entryId, next, JSON.stringify(content), actor?.userId ?? null],
  );
  const row = await adapter.queryOne<RevisionRow>('SELECT * FROM revisions WHERE id = ?', [id]);
  if (!row) throw new Error('failed to write revision');
  return rowToDTO(row);
}

export async function listRevisions(
  adapter: DatabaseAdapter,
  entryId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ items: RevisionSummary[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  const rows = await adapter.query<RevisionRow>(
    `SELECT id, entry_id, revision_number, '' AS content, created_at, created_by
     FROM revisions
     WHERE entry_id = ?
     ORDER BY revision_number DESC
     LIMIT ? OFFSET ?`,
    [entryId, limit, offset],
  );
  const totalRow = await adapter.queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM revisions WHERE entry_id = ?',
    [entryId],
  );
  return {
    items: rows.map(rowToSummary),
    total: Number(totalRow?.c ?? 0),
    limit,
    offset,
  };
}

export async function getRevision(
  adapter: DatabaseAdapter,
  entryId: string,
  revisionId: string,
): Promise<RevisionDTO | null> {
  const row = await adapter.queryOne<RevisionRow>(
    'SELECT * FROM revisions WHERE id = ? AND entry_id = ?',
    [revisionId, entryId],
  );
  return row ? rowToDTO(row) : null;
}
