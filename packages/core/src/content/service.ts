import type { DatabaseAdapter } from '@vulse/db';
import { ulid } from 'ulid';
import type { Blueprint } from '../blueprints/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { buildFilterSql, buildOrderSql } from './filter-sql.js';
import { snapshotRevision } from '../revisions/service.js';
import type {
  ContentService,
  Entry,
  EntryNode,
  ListEntriesOptions,
  MoveEntryInput,
} from './types.js';

interface EntryRow {
  id: string;
  collection_handle: string;
  parent_id: string | null;
  sort_order: number;
  status: string;
  protected: number;
  content: string;
  draft_content: string | null;
  published_at: string | null;
  published_by: string | null;
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
    const draftContent = row.draft_content ? JSON.parse(row.draft_content) : null;
    return {
      id: row.id,
      collection: row.collection_handle,
      parentId: row.parent_id,
      sortOrder: row.sort_order,
      status: row.status,
      protected: row.protected === 1,
      content: JSON.parse(row.content),
      draftContent,
      hasUnpublishedChanges: draftContent !== null,
      publishedAt: row.published_at,
      publishedBy: row.published_by,
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

    return clauses.length > 0
      ? { sql: ` AND (${clauses.join(' OR ')})`, params }
      : { sql: '', params: [] };
  }

  return {
    async list(handle, opts = {}) {
      const b = blueprint(handle);
      const limit = Math.max(1, Math.min(opts.limit ?? 25, 500));
      const offset = Math.max(0, opts.offset ?? 0);
      const search = buildSearchSql(b, opts);
      const filter = buildFilterSql(opts.filter, b);
      const order = buildOrderSql(opts.sort, b);
      const protectedClause = opts.includeProtected ? '' : ' AND protected = 0';
      const draftsClause = opts.includeDrafts ? '' : " AND status = 'published'";
      let parentClause = '';
      const parentParams: unknown[] = [];
      if ('parentId' in opts) {
        if (opts.parentId === null) {
          parentClause = ' AND parent_id IS NULL';
        } else if (typeof opts.parentId === 'string') {
          parentClause = ' AND parent_id = ?';
          parentParams.push(opts.parentId);
        }
      }
      const whereSql = `WHERE collection_handle = ?${protectedClause}${draftsClause}${parentClause}${search.sql}${filter.sql}`;
      const whereParams = [handle, ...parentParams, ...search.params, ...filter.params];

      const totalRow = await db.queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total FROM entries ${whereSql}`,
        whereParams,
      );
      const rows = await db.query<EntryRow>(
        `SELECT * FROM entries
         ${whereSql}
         ${order.sql}
         LIMIT ? OFFSET ?`,
        [...whereParams, ...order.params, limit, offset],
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

    async create(handle, input, ctx, opts) {
      const b = blueprint(handle);
      if (b.singleton) {
        const existing = await db.queryOne<{ id: string }>(
          'SELECT id FROM entries WHERE collection_handle = ? LIMIT 1',
          [handle],
        );
        if (existing) {
          throw new ConflictError('This singleton collection already has an entry.');
        }
      }
      const validated = validate(b, input);
      const id = ulid();
      const parentIdInput = (input as { parentId?: string | null }).parentId ?? null;

      if (parentIdInput !== null) {
        if (!b.tree) {
          throw new ValidationError([
            {
              code: 'custom',
              message: `Collection '${handle}' does not support nested entries.`,
              path: ['parentId'],
            },
          ]);
        }
        await assertParentValid(db, handle, parentIdInput, b.maxDepth);
      }

      const max = await maxSortOrder(db, handle, parentIdInput);
      const sortOrder = max + 1;
      const isProtected = (input as { protected?: boolean }).protected ? 1 : 0;

      // Drafts-enabled + explicit publish=false → write to draft_content, status=draft, content={}.
      // Otherwise (drafts-disabled OR publish !== false) → write to content live.
      const draftsEnabled = b.drafts === true;
      const saveAsDraft = draftsEnabled && opts?.publish === false;
      const actorId = ctx?.actor?.userId ?? null;

      if (saveAsDraft) {
        await db.exec(
          `INSERT INTO entries (id, collection_handle, parent_id, sort_order, status, protected, content, draft_content)
           VALUES (?, ?, ?, ?, 'draft', ?, '{}', ?)`,
          [id, handle, parentIdInput, sortOrder, isProtected, JSON.stringify(validated)],
        );
        await snapshotRevision(db, id, validated, ctx?.actor ?? null, 'draft');
      } else {
        await db.exec(
          `INSERT INTO entries (id, collection_handle, parent_id, sort_order, status, protected, content, published_at, published_by)
           VALUES (?, ?, ?, ?, 'published', ?, ?, datetime('now'), ?)`,
          [id, handle, parentIdInput, sortOrder, isProtected, JSON.stringify(validated), actorId],
        );
        await snapshotRevision(db, id, validated, ctx?.actor ?? null, 'publish');
      }

      const row = await db.queryOne<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
      return rowToEntry(row!);
    },

    async update(handle, id, input, ctx, opts) {
      const b = blueprint(handle);
      const existing = await db.queryOne<EntryRow>(
        'SELECT * FROM entries WHERE collection_handle = ? AND id = ?',
        [handle, id],
      );
      if (!existing) throw new NotFoundError(`entry not found: ${id}`);

      // Merge against the *working* copy — draft if present, otherwise live content.
      const baseContent = existing.draft_content
        ? JSON.parse(existing.draft_content)
        : JSON.parse(existing.content);
      const merged = { ...baseContent, ...(input as object) };
      const validated = validate(b, merged);

      const draftsEnabled = b.drafts === true;
      // For drafts-disabled collections, always publish (today's behaviour).
      // For drafts-enabled, default is draft (publish only when caller explicitly asks).
      const publishNow = !draftsEnabled || opts?.publish === true;
      const actorId = ctx?.actor?.userId ?? null;

      if (publishNow) {
        const fields: string[] = ['content = ?', "updated_at = datetime('now')"];
        const params: unknown[] = [JSON.stringify(validated)];
        if (draftsEnabled) {
          fields.push(
            'draft_content = NULL',
            "status = 'published'",
            "published_at = datetime('now')",
            'published_by = ?',
          );
          params.push(actorId);
        }
        if ('protected' in (input as object)) {
          fields.push('protected = ?');
          params.push((input as { protected: boolean }).protected ? 1 : 0);
        }
        await db.exec(`UPDATE entries SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
        await snapshotRevision(db, id, validated, ctx?.actor ?? null, 'publish');
      } else {
        // Save as draft — leave content alone (or it's already empty for status=draft).
        const fields: string[] = ['draft_content = ?', "updated_at = datetime('now')"];
        const params: unknown[] = [JSON.stringify(validated)];
        if ('protected' in (input as object)) {
          fields.push('protected = ?');
          params.push((input as { protected: boolean }).protected ? 1 : 0);
        }
        await db.exec(`UPDATE entries SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
        await snapshotRevision(db, id, validated, ctx?.actor ?? null, 'draft');
      }

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

    async move(handle, id, input) {
      const b = blueprint(handle);
      if (!b.tree) {
        throw new ValidationError([
          {
            code: 'custom',
            message: `Collection '${handle}' does not support nested entries.`,
            path: ['parentId'],
          },
        ]);
      }
      const existing = await db.queryOne<EntryRow>(
        'SELECT * FROM entries WHERE collection_handle = ? AND id = ?',
        [handle, id],
      );
      if (!existing) throw new NotFoundError(`entry not found: ${id}`);

      const newParentId: string | null = input.parentId;
      if (newParentId !== null) {
        if (newParentId === id) {
          throw new ValidationError([
            {
              code: 'custom',
              message: 'An entry cannot be its own parent.',
              path: ['parentId'],
            },
          ]);
        }
        await assertParentValid(db, handle, newParentId, undefined);
        // Cycle detection: walk new parent's ancestors, none may equal id.
        await assertNoCycle(db, handle, id, newParentId);
        if (b.maxDepth !== undefined) {
          const subtreeDepth = await computeSubtreeDepth(db, id);
          const parentDepth = await computeAncestorDepth(db, newParentId);
          // depth of entry's deepest descendant under new parent =
          // parentDepth + 1 (entry itself) + subtreeDepth
          if (parentDepth + 1 + subtreeDepth > b.maxDepth) {
            throw new ValidationError([
              {
                code: 'custom',
                message: `Moving this entry would exceed the collection's maxDepth of ${b.maxDepth}.`,
                path: ['parentId'],
              },
            ]);
          }
        }
      } else if (b.maxDepth !== undefined) {
        // Moving to root: subtreeDepth must fit on its own.
        const subtreeDepth = await computeSubtreeDepth(db, id);
        if (1 + subtreeDepth > b.maxDepth) {
          throw new ValidationError([
            {
              code: 'custom',
              message: `Moving this entry would exceed the collection's maxDepth of ${b.maxDepth}.`,
              path: ['parentId'],
            },
          ]);
        }
      }

      // Compute target sort_order. If caller specified, use it as a target
      // position and re-pack siblings; otherwise append to end.
      const targetOrder =
        input.sortOrder !== undefined && input.sortOrder >= 1
          ? Math.floor(input.sortOrder)
          : (await maxSortOrder(db, handle, newParentId)) + 1;

      // Stage the move with the requested order, then re-pack.
      await db.exec(
        `UPDATE entries SET parent_id = ?, sort_order = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [newParentId, targetOrder, id],
      );
      await repackSiblings(db, handle, newParentId, id, targetOrder);
      // Also re-pack the old siblings to close any gap.
      if (existing.parent_id !== newParentId) {
        await repackSiblings(db, handle, existing.parent_id, null, null);
      }

      const row = await db.queryOne<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
      return rowToEntry(row!);
    },

    async tree(handle, opts = {}) {
      const b = blueprint(handle);
      if (!b.tree) {
        throw new ValidationError([
          {
            code: 'custom',
            message: `Collection '${handle}' does not support nested entries.`,
            path: ['handle'],
          },
        ]);
      }
      const protectedClause = opts.includeProtected ? '' : ' AND protected = 0';
      // Note: tree() doesn't expose includeDrafts in the public interface yet (not in ContentService.tree signature),
      // so we default to filtering drafts (includeDrafts: false). This is internal-only.
      const draftsClause = " AND status = 'published'";
      const rows = await db.query<EntryRow>(
        `SELECT * FROM entries
         WHERE collection_handle = ?${protectedClause}${draftsClause}
         ORDER BY sort_order ASC, created_at DESC`,
        [handle],
      );
      const byParent = new Map<string | null, EntryNode[]>();
      for (const row of rows) {
        const node: EntryNode = { ...rowToEntry(row), children: [] };
        const bucket = byParent.get(node.parentId) ?? [];
        bucket.push(node);
        byParent.set(node.parentId, bucket);
      }
      function attach(parentId: string | null): EntryNode[] {
        const children = byParent.get(parentId) ?? [];
        for (const child of children) {
          child.children = attach(child.id);
        }
        return children;
      }
      return attach(null);
    },

    async publish(handle, id, ctx) {
      const b = blueprint(handle);
      if (!b.drafts) {
        throw new ValidationError([
          {
            code: 'drafts_not_enabled',
            message: `Collection '${handle}' does not have drafts enabled.`,
            path: ['handle'],
          } as never,
        ]);
      }
      const row = await db.queryOne<EntryRow>(
        'SELECT * FROM entries WHERE collection_handle = ? AND id = ?',
        [handle, id],
      );
      if (!row) throw new NotFoundError(`entry not found: ${id}`);
      const promote = row.draft_content ? JSON.parse(row.draft_content) : JSON.parse(row.content);
      await db.exec(
        `UPDATE entries
         SET content = ?, draft_content = NULL, status = 'published',
             published_at = datetime('now'), published_by = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [JSON.stringify(promote), ctx?.actor?.userId ?? null, id],
      );
      await snapshotRevision(db, id, promote, ctx?.actor ?? null, 'publish');
      const updated = await db.queryOne<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
      return rowToEntry(updated!);
    },

    async unpublish(handle, id, _ctx) {
      const b = blueprint(handle);
      if (!b.drafts) {
        throw new ValidationError([
          {
            code: 'drafts_not_enabled',
            message: `Collection '${handle}' does not have drafts enabled.`,
            path: ['handle'],
          } as never,
        ]);
      }
      const row = await db.queryOne<EntryRow>(
        'SELECT * FROM entries WHERE collection_handle = ? AND id = ?',
        [handle, id],
      );
      if (!row) throw new NotFoundError(`entry not found: ${id}`);
      if (row.status === 'draft') {
        throw new ValidationError([
          {
            code: 'entry_already_draft',
            message: 'Entry has never been published.',
            path: ['id'],
          } as never,
        ]);
      }
      await db.exec(
        `UPDATE entries
         SET draft_content = COALESCE(draft_content, content),
             content = '{}', status = 'draft',
             published_at = NULL, published_by = NULL, updated_at = datetime('now')
         WHERE id = ?`,
        [id],
      );
      const updated = await db.queryOne<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
      return rowToEntry(updated!);
    },

    async discardDraft(handle, id, _ctx) {
      const b = blueprint(handle);
      if (!b.drafts) {
        throw new ValidationError([
          {
            code: 'drafts_not_enabled',
            message: `Collection '${handle}' does not have drafts enabled.`,
            path: ['handle'],
          } as never,
        ]);
      }
      const row = await db.queryOne<EntryRow>(
        'SELECT * FROM entries WHERE collection_handle = ? AND id = ?',
        [handle, id],
      );
      if (!row) throw new NotFoundError(`entry not found: ${id}`);
      if (row.status === 'draft') {
        throw new ValidationError([
          {
            code: 'cannot_discard_initial_draft',
            message: 'This entry has no published copy. Delete it instead.',
            path: ['id'],
          } as never,
        ]);
      }
      if (row.draft_content === null) {
        throw new ValidationError([
          {
            code: 'no_draft_to_discard',
            message: 'Entry has no pending draft.',
            path: ['id'],
          } as never,
        ]);
      }
      await db.exec(
        `UPDATE entries SET draft_content = NULL, updated_at = datetime('now') WHERE id = ?`,
        [id],
      );
      const updated = await db.queryOne<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
      return rowToEntry(updated!);
    },
  };
}

async function maxSortOrder(
  db: DatabaseAdapter,
  handle: string,
  parentId: string | null,
): Promise<number> {
  if (parentId === null) {
    const row = await db.queryOne<{ m: number | null }>(
      'SELECT MAX(sort_order) AS m FROM entries WHERE collection_handle = ? AND parent_id IS NULL',
      [handle],
    );
    return row?.m ?? 0;
  }
  const row = await db.queryOne<{ m: number | null }>(
    'SELECT MAX(sort_order) AS m FROM entries WHERE collection_handle = ? AND parent_id = ?',
    [handle, parentId],
  );
  return row?.m ?? 0;
}

async function assertParentValid(
  db: DatabaseAdapter,
  handle: string,
  parentId: string,
  maxDepth: number | undefined,
): Promise<void> {
  const parent = await db.queryOne<{ id: string; collection_handle: string }>(
    'SELECT id, collection_handle FROM entries WHERE id = ?',
    [parentId],
  );
  if (!parent) {
    throw new ValidationError([
      { code: 'custom', message: `Parent entry '${parentId}' not found.`, path: ['parentId'] },
    ]);
  }
  if (parent.collection_handle !== handle) {
    throw new ValidationError([
      {
        code: 'custom',
        message: 'Parent entry must belong to the same collection.',
        path: ['parentId'],
      },
    ]);
  }
  if (maxDepth !== undefined) {
    const parentDepth = await computeAncestorDepth(db, parentId);
    // New child sits at parentDepth + 1 (depth counted from 1).
    if (parentDepth + 1 > maxDepth) {
      throw new ValidationError([
        {
          code: 'custom',
          message: `Nesting under this entry would exceed the collection's maxDepth of ${maxDepth}.`,
          path: ['parentId'],
        },
      ]);
    }
  }
}

type ParentRow = { parent_id: string | null };

async function assertNoCycle(
  db: DatabaseAdapter,
  handle: string,
  movingId: string,
  newParentId: string,
): Promise<void> {
  let cursor: string | null = newParentId;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    if (cursor === movingId) {
      throw new ValidationError([
        {
          code: 'custom',
          message: 'Cannot move an entry beneath one of its own descendants.',
          path: ['parentId'],
        },
      ]);
    }
    const row: ParentRow | null = await db.queryOne<ParentRow>(
      'SELECT parent_id FROM entries WHERE id = ? AND collection_handle = ?',
      [cursor, handle],
    );
    cursor = row?.parent_id ?? null;
  }
}

async function computeAncestorDepth(db: DatabaseAdapter, entryId: string): Promise<number> {
  let cursor: string | null = entryId;
  let depth = 0;
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    depth += 1;
    const row: ParentRow | null = await db.queryOne<ParentRow>(
      'SELECT parent_id FROM entries WHERE id = ?',
      [cursor],
    );
    cursor = row?.parent_id ?? null;
  }
  return depth;
}

async function computeSubtreeDepth(db: DatabaseAdapter, rootId: string): Promise<number> {
  // Returns the depth of the deepest descendant below rootId (0 if no children).
  let level: string[] = [rootId];
  let depth = 0;
  while (level.length > 0) {
    const placeholders = level.map(() => '?').join(',');
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM entries WHERE parent_id IN (${placeholders})`,
      level,
    );
    if (rows.length === 0) break;
    depth += 1;
    level = rows.map((r) => r.id);
  }
  return depth;
}

async function repackSiblings(
  db: DatabaseAdapter,
  handle: string,
  parentId: string | null,
  pinnedId: string | null,
  pinnedOrder: number | null,
): Promise<void> {
  // Re-pack sort_order to consecutive 1..N. When pinnedId is provided, it
  // keeps its requested target slot (ties broken by created_at DESC like
  // the existing ORDER BY in list()).
  type SiblingRow = { id: string; sort_order: number; created_at: string };
  const rows: SiblingRow[] =
    parentId === null
      ? await db.query<SiblingRow>(
          `SELECT id, sort_order, created_at FROM entries
           WHERE collection_handle = ? AND parent_id IS NULL
           ORDER BY sort_order ASC, created_at DESC`,
          [handle],
        )
      : await db.query<SiblingRow>(
          `SELECT id, sort_order, created_at FROM entries
           WHERE collection_handle = ? AND parent_id = ?
           ORDER BY sort_order ASC, created_at DESC`,
          [handle, parentId],
        );

  // Sort: pinned entry first claims its requested slot, others fill around.
  let pinned: SiblingRow | null = null;
  const others: SiblingRow[] = [];
  for (const row of rows) {
    if (row.id === pinnedId) pinned = row;
    else others.push(row);
  }
  const result: SiblingRow[] = others.slice();
  if (pinned && pinnedOrder !== null) {
    const target = Math.max(1, Math.min(pinnedOrder, result.length + 1));
    result.splice(target - 1, 0, pinned);
  } else if (pinned) {
    result.push(pinned);
  }
  for (let i = 0; i < result.length; i++) {
    const desired = i + 1;
    if (result[i]!.sort_order !== desired) {
      await db.exec(`UPDATE entries SET sort_order = ? WHERE id = ?`, [desired, result[i]!.id]);
    }
  }
}
