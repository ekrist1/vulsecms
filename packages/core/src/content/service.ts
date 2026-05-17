import type { DatabaseAdapter } from '@vulse/db';
import { ulid } from 'ulid';
import type { Blueprint } from '../blueprints/types.js';
import { NotFoundError, ValidationError } from '../errors.js';
import type { ContentService, Entry, ListEntriesOptions } from './types.js';

interface EntryRow {
  id: string;
  collection_handle: string;
  parent_id: string | null;
  sort_order: number;
  status: string;
  protected: number;
  content: string;
  created_at: string;
  updated_at: string;
}

const SEARCHABLE_FIELD_KINDS = new Set(['text', 'textarea', 'select', 'relationship', 'date']);

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
      protected: row.protected === 1,
      content: JSON.parse(row.content),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function searchableFieldNames(b: Blueprint): Set<string> {
    return new Set(
      b.fields
        .filter((field) => SEARCHABLE_FIELD_KINDS.has(field.ui.kind))
        .map((field) => field.name),
    );
  }

  function buildSearchSql(
    b: Blueprint,
    opts: ListEntriesOptions,
  ): { sql: string; params: unknown[] } {
    const q = opts.q?.trim();
    if (!q) return { sql: '', params: [] };

    const like = `%${q}%`;
    const requestedField = opts.field?.trim();
    const searchableFields = searchableFieldNames(b);
    const clauses: string[] = [];
    const params: unknown[] = [];

    const addPlainLike = (column: string) => {
      clauses.push(`${column} LIKE ? COLLATE NOCASE`);
      params.push(like);
    };

    const addJsonLike = (fieldName: string) => {
      clauses.push(`CAST(json_extract(content, ?) AS TEXT) LIKE ? COLLATE NOCASE`);
      params.push(`$.${fieldName}`, like);
    };

    if (requestedField === 'id') {
      addPlainLike('id');
    } else if (requestedField === 'updatedAt') {
      addPlainLike('updated_at');
    } else if (requestedField && searchableFields.has(requestedField)) {
      addJsonLike(requestedField);
    } else {
      addPlainLike('id');
      addPlainLike('updated_at');
      for (const fieldName of searchableFields) addJsonLike(fieldName);
    }

    return clauses.length > 0 ? { sql: ` AND (${clauses.join(' OR ')})`, params } : { sql: '', params: [] };
  }

  return {
    async list(handle, opts = {}) {
      const b = blueprint(handle);
      const limit = Math.max(1, Math.min(opts.limit ?? 25, 500));
      const offset = Math.max(0, opts.offset ?? 0);
      const search = buildSearchSql(b, opts);
      const protectedClause = opts.includeProtected ? '' : ' AND protected = 0';
      const whereSql = `WHERE collection_handle = ?${protectedClause}${search.sql}`;
      const whereParams = [handle, ...search.params];

      const totalRow = await db.queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total FROM entries ${whereSql}`,
        whereParams,
      );
      const rows = await db.query<EntryRow>(
        `SELECT * FROM entries
         ${whereSql}
         ORDER BY sort_order ASC, created_at DESC
         LIMIT ? OFFSET ?`,
        [...whereParams, limit, offset],
      );
      return {
        items: rows.map(rowToEntry),
        total: totalRow?.total ?? 0,
        limit,
        offset,
      };
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
      const isProtected = (input as { protected?: boolean }).protected ? 1 : 0;
      await db.exec(
        `INSERT INTO entries (id, collection_handle, parent_id, sort_order, status, protected, content)
         VALUES (?, ?, ?, ?, 'published', ?, ?)`,
        [id, handle, parentId, sortOrder, isProtected, JSON.stringify(validated)],
      );
      const row = await db.queryOne<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
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
      const fields: string[] = ['content = ?', `updated_at = datetime('now')`];
      const params: unknown[] = [JSON.stringify(validated)];
      if ('protected' in (input as object)) {
        fields.push('protected = ?');
        params.push((input as { protected: boolean }).protected ? 1 : 0);
      }
      await db.exec(`UPDATE entries SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
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
