import { ulid } from 'ulid';
import type { DatabaseAdapter } from '@vulse/db';
import type { Blueprint } from '../blueprints/types.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { ContentService, Entry } from './types.js';

interface EntryRow {
  id: string;
  collection_handle: string;
  parent_id: string | null;
  sort_order: number;
  status: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function createContentService(
  db: DatabaseAdapter,
  blueprints: Map<string, Blueprint>,
): ContentService {
  function blueprint(handle: string): Blueprint {
    const b = blueprints.get(handle);
    if (!b) throw new NotFoundError(`unknown collection: ${handle}`);
    return b;
  }

  function validate(b: Blueprint, input: unknown): Record<string, unknown> {
    const result = b.schema.safeParse(input);
    if (!result.success) throw new ValidationError(result.error.issues);
    return result.data as Record<string, unknown>;
  }

  function rowToEntry(row: EntryRow): Entry {
    return {
      id: row.id,
      collection: row.collection_handle,
      parentId: row.parent_id,
      sortOrder: row.sort_order,
      status: row.status,
      content: JSON.parse(row.content),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    async list(handle, opts = {}) {
      blueprint(handle);
      const limit = opts.limit ?? 100;
      const offset = opts.offset ?? 0;
      const rows = await db.query<EntryRow>(
        `SELECT * FROM entries
         WHERE collection_handle = ?
         ORDER BY sort_order ASC, created_at DESC
         LIMIT ? OFFSET ?`,
        [handle, limit, offset],
      );
      return rows.map(rowToEntry);
    },

    async get(handle, id) {
      blueprint(handle);
      const row = await db.queryOne<EntryRow>(
        'SELECT * FROM entries WHERE collection_handle = ? AND id = ?',
        [handle, id],
      );
      return row ? rowToEntry(row) : null;
    },

    async create(handle, input) {
      const b = blueprint(handle);
      const validated = validate(b, input);
      const id = ulid();
      const parentId = (input as { parentId?: string | null }).parentId ?? null;

      let max: { m: number | null } | null;
      if (parentId === null) {
        max = await db.queryOne<{ m: number | null }>(
          'SELECT MAX(sort_order) AS m FROM entries WHERE collection_handle = ? AND parent_id IS NULL',
          [handle],
        );
      } else {
        max = await db.queryOne<{ m: number | null }>(
          'SELECT MAX(sort_order) AS m FROM entries WHERE collection_handle = ? AND parent_id = ?',
          [handle, parentId],
        );
      }

      const sortOrder = (max?.m ?? 0) + 1;
      await db.exec(
        `INSERT INTO entries (id, collection_handle, parent_id, sort_order, status, content)
         VALUES (?, ?, ?, ?, 'published', ?)`,
        [id, handle, parentId, sortOrder, JSON.stringify(validated)],
      );
      const row = await db.queryOne<EntryRow>(
        'SELECT * FROM entries WHERE id = ?',
        [id],
      );
      return rowToEntry(row!);
    },

    async update(handle, id, input) {
      const b = blueprint(handle);
      const existing = await db.queryOne<EntryRow>(
        'SELECT * FROM entries WHERE collection_handle = ? AND id = ?',
        [handle, id],
      );
      if (!existing) throw new NotFoundError(`entry not found: ${id}`);
      const merged = { ...JSON.parse(existing.content), ...(input as object) };
      const validated = validate(b, merged);
      await db.exec(
        `UPDATE entries SET content = ?, updated_at = datetime('now') WHERE id = ?`,
        [JSON.stringify(validated), id],
      );
      const row = await db.queryOne<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
      return rowToEntry(row!);
    },

    async delete(handle, id) {
      blueprint(handle);
      const existing = await db.queryOne<{ id: string }>(
        'SELECT id FROM entries WHERE collection_handle = ? AND id = ?',
        [handle, id],
      );
      if (!existing) throw new NotFoundError(`entry not found: ${id}`);
      await db.exec('DELETE FROM entries WHERE id = ?', [id]);
    },
  };
}
