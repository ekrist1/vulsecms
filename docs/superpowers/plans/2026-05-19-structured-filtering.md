# Structured filtering on collection lists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured `filter` + `sort` to `ContentService.list`,
expose them on `GET /api/collections/:handle` via bracket-nested
query strings, thread them through `SiteRouteOverride`, and update
the developer docs.

**Architecture:** Two pure helpers in `@vulse/core/content` —
`buildFilterSql(filter, blueprint)` and
`buildOrderSql(sort, blueprint)` — produce `{sql, params}` fragments
the existing `list()` concatenates into its WHERE / ORDER BY. A small
`parseListQuery(query)` helper in `@vulse/core/http` turns the flat
query map Hono returns into the structured `{filter, sort}` shape.
The site renderer adds `filter` + `sort` keys to `SiteRouteOverride`
and threads them straight into `content.list`. Strict 400 on unknown
fields. Docs/site.md updates the Filtering section.

**Tech Stack:** TypeScript, Zod (already used elsewhere in core),
Hono v4 (existing route handler), libSQL (existing adapter, no new
SQL features needed beyond `json_extract`).

**Reference spec:** `docs/superpowers/specs/2026-05-18-structured-filtering-design.md`

**Execution order:** Phase A → B → C → D. Each phase ends with a
green workspace (`pnpm -r test`, `pnpm -r check`,
`pnpm biome check .`).

---

## File Map

### `@vulse/core` (Phase A + B)
```
packages/core/src/content/
├── types.ts                          MODIFY — add FilterValue, FieldFilter, SortSpec; extend ListEntriesOptions
├── filter-sql.ts                     NEW — buildFilterSql + buildOrderSql + allowed-key resolution + value coercion
├── service.ts                        MODIFY — thread buildFilterSql/buildOrderSql into list()
└── __tests__/
    ├── service.test.ts               MODIFY — add "list with filters/sort" describe block
    └── filter-sql.test.ts            NEW — unit tests for the SQL builders in isolation

packages/core/src/http/
├── filter-parser.ts                  NEW — parseListQuery({filter[...][...]=v, sort=...}) → {filter, sort}
├── api.ts                            MODIFY — call parseListQuery in the list handler; surface errors as 400
└── __tests__/
    ├── filter-parser.test.ts         NEW
    └── api.test.ts                   MODIFY — filter + sort happy paths + 400 on unknown field
```

### `@vulse/site` (Phase C)
```
packages/site/src/
├── types.ts                          MODIFY — extend SiteRouteOverride with filter? and sort?
├── server/middleware/render.ts       MODIFY — thread filter+sort into content.list in resolveOverride
└── server/middleware/render.test.ts  MODIFY — add a case for filter-on-override
```

### Docs (Phase D)
```
docs/site.md                          MODIFY — replace "current limitations" subsection with a real "Filtering" section; remove G1 from Planned features
```

### Re-exports
```
packages/core/src/index.ts            MODIFY — re-export FieldFilter, SortSpec, FilterValue, parseListQuery (the latter only if it's needed externally; otherwise keep internal)
```

---

# Phase A — Types + SQL builder

End state: `ContentService.list({filter, sort})` produces the right
SQL and returns the right entries. Tests cover every operator on a
top-level column AND a content field, multi-operator on one field,
multi-field, multi-sort, default-sort preservation, q+filter
combination, and unknown-field rejection.

---

## Task A1: Types

**Files:**
- Modify: `packages/core/src/content/types.ts`

- [ ] **Step 1: Extend `ListEntriesOptions`**

Add to `packages/core/src/content/types.ts` near the top (alongside
the existing `ListEntriesOptions`):

```ts
export type FilterValue = string | number | boolean;

export interface FieldFilter {
  eq?: FilterValue;
  neq?: FilterValue;
  in?: FilterValue[];
  gt?: FilterValue;
  gte?: FilterValue;
  lt?: FilterValue;
  lte?: FilterValue;
}

export interface SortSpec {
  field: string;
  direction: 'asc' | 'desc';
}
```

Then extend `ListEntriesOptions` (existing shape — preserve all
current fields):

```ts
export interface ListEntriesOptions {
  limit?: number;
  offset?: number;
  q?: string;
  field?: string;
  includeProtected?: boolean;
  parentId?: string | null;       // existing optional
  filter?: Record<string, FieldFilter>;
  sort?: SortSpec[];
}
```

(`parentId` is in the current shape — check the file before editing
to confirm exact field set. Don't drop anything.)

- [ ] **Step 2: Re-export new types from `@vulse/core`**

In `packages/core/src/index.ts`, add to the existing content types
re-export:

```ts
export type {
  FilterValue,
  FieldFilter,
  SortSpec,
  ListEntriesOptions,
  // ... other existing exports ...
} from './content/types.js';
```

(Find the line that currently exports types from `./content/types.js`
and add the three new names. If `ListEntriesOptions` isn't already
re-exported, add it too — it's now part of the public API.)

- [ ] **Step 3: Typecheck**

```bash
cd /home/espen/jsdev/vulsecms
pnpm --filter @vulse/core check
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/content/types.ts packages/core/src/index.ts
git commit -m "feat(core): FilterValue + FieldFilter + SortSpec types on ListEntriesOptions"
```

---

## Task A2: `buildFilterSql` helper

**Files:**
- Create: `packages/core/src/content/filter-sql.ts`
- Create: `packages/core/src/content/__tests__/filter-sql.test.ts`

The helper validates filter keys against the blueprint, coerces
values, and emits parameterized SQL fragments. Top-level columns get
plain comparisons; content fields use `json_extract`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/content/__tests__/filter-sql.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../errors.js';
import type { Blueprint } from '../../blueprints/types.js';
import { buildFilterSql } from '../filter-sql.js';

function bp(extra?: Partial<Blueprint>): Blueprint {
  return {
    handle: 'posts',
    label: 'Posts',
    singleton: false,
    tree: false,
    schema: { safeParse: () => ({ success: true, data: {} }) } as unknown as Blueprint['schema'],
    fields: [
      { name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false },
      { name: 'status', label: 'Status', ui: { kind: 'select', options: ['draft', 'published', 'scheduled'] }, optional: false },
      { name: 'publishedAt', label: 'Published', ui: { kind: 'date' }, optional: true },
      { name: 'featured', label: 'Featured', ui: { kind: 'boolean' }, optional: true },
    ],
    ...extra,
  } as Blueprint;
}

describe('buildFilterSql', () => {
  it('returns empty fragment when filter is missing', () => {
    expect(buildFilterSql(undefined, bp())).toEqual({ sql: '', params: [] });
    expect(buildFilterSql({}, bp())).toEqual({ sql: '', params: [] });
  });

  it('builds equality on a top-level id column (plain SQL, no json_extract)', () => {
    const out = buildFilterSql({ id: { eq: 'abc' } }, bp());
    expect(out.sql).toBe(' AND id = ?');
    expect(out.params).toEqual(['abc']);
  });

  it('builds equality on a content field via json_extract', () => {
    const out = buildFilterSql({ status: { eq: 'published' } }, bp());
    expect(out.sql).toBe(" AND CAST(json_extract(content, ?) AS TEXT) = ?");
    expect(out.params).toEqual(['$.status', 'published']);
  });

  it('builds IN with multiple values', () => {
    const out = buildFilterSql({ status: { in: ['published', 'scheduled'] } }, bp());
    expect(out.sql).toBe(" AND CAST(json_extract(content, ?) AS TEXT) IN (?, ?)");
    expect(out.params).toEqual(['$.status', 'published', 'scheduled']);
  });

  it('builds IN with empty array as a false predicate', () => {
    const out = buildFilterSql({ status: { in: [] } }, bp());
    expect(out.sql).toBe(' AND 0');
    expect(out.params).toEqual([]);
  });

  it('ANDs multiple operators on one field', () => {
    const out = buildFilterSql({ publishedAt: { gte: '2024-01-01', lt: '2025-01-01' } }, bp());
    // Order of operators within a field is stable (eq, neq, in, gt, gte, lt, lte).
    expect(out.sql).toBe(
      " AND CAST(json_extract(content, ?) AS TEXT) >= ? AND CAST(json_extract(content, ?) AS TEXT) < ?"
    );
    expect(out.params).toEqual(['$.publishedAt', '2024-01-01', '$.publishedAt', '2025-01-01']);
  });

  it('ANDs multiple fields', () => {
    const out = buildFilterSql(
      { status: { eq: 'published' }, publishedAt: { gte: '2024-01-01' } },
      bp(),
    );
    // Field order matches insertion order on the input object.
    expect(out.sql).toBe(
      " AND CAST(json_extract(content, ?) AS TEXT) = ? AND CAST(json_extract(content, ?) AS TEXT) >= ?"
    );
    expect(out.params).toEqual(['$.status', 'published', '$.publishedAt', '2024-01-01']);
  });

  it('coerces boolean values for protected column', () => {
    const out = buildFilterSql({ protected: { eq: true } }, bp());
    expect(out.sql).toBe(' AND protected = ?');
    expect(out.params).toEqual([1]);
  });

  it('coerces "true"/"false" strings for boolean content fields', () => {
    const out = buildFilterSql({ featured: { eq: 'true' } }, bp());
    expect(out.params).toEqual(['$.featured', 1]);
  });

  it('throws ValidationError on unknown field', () => {
    expect(() => buildFilterSql({ nope: { eq: 'x' } }, bp())).toThrow(ValidationError);
  });

  it('throws ValidationError when a comparison operator is given a boolean field', () => {
    expect(() => buildFilterSql({ featured: { gt: true } }, bp())).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
cd /home/espen/jsdev/vulsecms
pnpm --filter @vulse/core test -- filter-sql
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildFilterSql`**

Create `packages/core/src/content/filter-sql.ts`:

```ts
import type { Blueprint, FieldDefinition } from '../blueprints/types.js';
import { ValidationError } from '../errors.js';
import type { FieldFilter, FilterValue, SortSpec } from './types.js';

const TOP_LEVEL_COLUMNS: Record<string, 'text' | 'integer'> = {
  id: 'text',
  status: 'text',
  parent_id: 'text',
  parentId: 'text',
  protected: 'integer',
  sort_order: 'integer',
  sortOrder: 'integer',
  created_at: 'text',
  createdAt: 'text',
  updated_at: 'text',
  updatedAt: 'text',
};

const TOP_LEVEL_COLUMN_NAME: Record<string, string> = {
  id: 'id',
  status: 'status',
  parent_id: 'parent_id',
  parentId: 'parent_id',
  protected: 'protected',
  sort_order: 'sort_order',
  sortOrder: 'sort_order',
  created_at: 'created_at',
  createdAt: 'created_at',
  updated_at: 'updated_at',
  updatedAt: 'updated_at',
};

const BOOLEAN_TOP_LEVEL = new Set(['protected']);
const NUMERIC_TOP_LEVEL = new Set(['sort_order']);

const OP_SQL: Record<keyof FieldFilter, string> = {
  eq: '=',
  neq: '!=',
  in: 'IN',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

const OP_ORDER: Array<keyof FieldFilter> = ['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte'];

const COMPARISON_OPS = new Set<keyof FieldFilter>(['gt', 'gte', 'lt', 'lte']);

export interface SqlFragment {
  sql: string;
  params: unknown[];
}

interface ResolvedKey {
  kind: 'column' | 'content';
  expr: string;           // SQL expression (e.g. "status" or 'CAST(json_extract(content, ?) AS TEXT)')
  needsPathParam: boolean; // when true, push '$.<field>' as the first param before the value
  pathParam?: string;
  field: FieldDefinition | null; // null for top-level columns
}

function resolveKey(key: string, b: Blueprint): ResolvedKey {
  if (key in TOP_LEVEL_COLUMNS) {
    return {
      kind: 'column',
      expr: TOP_LEVEL_COLUMN_NAME[key]!,
      needsPathParam: false,
      field: null,
    };
  }
  const field = b.fields.find((f) => f.name === key);
  if (!field) {
    throw new ValidationError([
      { code: 'custom', message: `Unknown filter field: ${key}`, path: ['filter', key] },
    ]);
  }
  return {
    kind: 'content',
    expr: 'CAST(json_extract(content, ?) AS TEXT)',
    needsPathParam: true,
    pathParam: `$.${key}`,
    field,
  };
}

function isBooleanKey(key: string, resolved: ResolvedKey): boolean {
  if (BOOLEAN_TOP_LEVEL.has(TOP_LEVEL_COLUMN_NAME[key] ?? key)) return true;
  return resolved.field?.ui.kind === 'boolean';
}

function isNumericKey(key: string, resolved: ResolvedKey): boolean {
  if (NUMERIC_TOP_LEVEL.has(TOP_LEVEL_COLUMN_NAME[key] ?? key)) return true;
  // No "number" field kind in Vulse v1 — only sort_order is numeric.
  return false;
}

function coerceValue(
  raw: FilterValue,
  key: string,
  resolved: ResolvedKey,
  op: keyof FieldFilter,
): unknown {
  if (isBooleanKey(key, resolved)) {
    if (COMPARISON_OPS.has(op)) {
      throw new ValidationError([
        {
          code: 'custom',
          message: `Operator '${op}' is not valid on boolean field '${key}'.`,
          path: ['filter', key, op],
        },
      ]);
    }
    if (raw === true || raw === 1 || raw === 'true' || raw === '1') return 1;
    if (raw === false || raw === 0 || raw === 'false' || raw === '0') return 0;
    throw new ValidationError([
      {
        code: 'custom',
        message: `Value '${String(raw)}' cannot be coerced to boolean for field '${key}'.`,
        path: ['filter', key, op],
      },
    ]);
  }
  if (isNumericKey(key, resolved)) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) {
      throw new ValidationError([
        {
          code: 'custom',
          message: `Value '${String(raw)}' cannot be coerced to number for field '${key}'.`,
          path: ['filter', key, op],
        },
      ]);
    }
    return n;
  }
  // String passthrough. Booleans on string-kind fields stringify.
  return typeof raw === 'string' ? raw : String(raw);
}

export function buildFilterSql(
  filter: Record<string, FieldFilter> | undefined,
  b: Blueprint,
): SqlFragment {
  if (!filter) return { sql: '', params: [] };
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const [key, ops] of Object.entries(filter)) {
    if (!ops || Object.keys(ops).length === 0) continue;
    const resolved = resolveKey(key, b);

    for (const op of OP_ORDER) {
      const raw = ops[op];
      if (raw === undefined) continue;

      if (op === 'in') {
        const values = Array.isArray(raw) ? raw : [];
        if (values.length === 0) {
          // Empty IN matches nothing.
          clauses.push('0');
          continue;
        }
        const placeholders = values.map(() => '?').join(', ');
        if (resolved.needsPathParam) {
          clauses.push(`${resolved.expr} IN (${placeholders})`);
          params.push(resolved.pathParam!);
        } else {
          clauses.push(`${resolved.expr} IN (${placeholders})`);
        }
        for (const v of values) params.push(coerceValue(v, key, resolved, op));
        continue;
      }

      // eq / neq / gt / gte / lt / lte
      const sqlOp = OP_SQL[op];
      const value = coerceValue(raw as FilterValue, key, resolved, op);
      if (resolved.needsPathParam) {
        clauses.push(`${resolved.expr} ${sqlOp} ?`);
        params.push(resolved.pathParam!, value);
      } else {
        clauses.push(`${resolved.expr} ${sqlOp} ?`);
        params.push(value);
      }
    }
  }

  if (clauses.length === 0) return { sql: '', params: [] };
  return { sql: ` AND ${clauses.join(' AND ')}`, params };
}

export function buildOrderSql(
  sort: SortSpec[] | undefined,
  b: Blueprint,
): SqlFragment {
  if (!sort || sort.length === 0) {
    return { sql: 'ORDER BY sort_order ASC, created_at DESC', params: [] };
  }
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const spec of sort) {
    const direction = spec.direction === 'desc' ? 'DESC' : 'ASC';
    if (spec.field in TOP_LEVEL_COLUMNS) {
      parts.push(`${TOP_LEVEL_COLUMN_NAME[spec.field]} ${direction}`);
      continue;
    }
    const field = b.fields.find((f) => f.name === spec.field);
    if (!field) {
      throw new ValidationError([
        { code: 'custom', message: `Unknown sort field: ${spec.field}`, path: ['sort', spec.field] },
      ]);
    }
    parts.push(`json_extract(content, ?) ${direction}`);
    params.push(`$.${spec.field}`);
  }
  return { sql: `ORDER BY ${parts.join(', ')}`, params };
}
```

- [ ] **Step 4: Run + verify pass**

```bash
pnpm --filter @vulse/core test -- filter-sql
```

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/content/filter-sql.ts packages/core/src/content/__tests__/filter-sql.test.ts
git commit -m "feat(core): buildFilterSql + buildOrderSql with validation and coercion"
```

---

## Task A3: Integrate into `list()`

**Files:**
- Modify: `packages/core/src/content/service.ts`
- Modify: `packages/core/src/content/service.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/content/service.test.ts` (after the
existing describe blocks):

```ts
describe('list with filters and sort', () => {
  // Use the same helpers that already exist in service.test.ts to set up
  // a blueprint + insert entries. Match the pattern used in earlier tests.
  // (If the test file uses a setup() helper, reuse it. The skeleton below
  // shows the assertions; the wiring depends on this file's existing style.)

  it('filters by content field equality', async () => {
    const { content } = await setupPostsWithEntries([
      { title: 'A', status: 'published' },
      { title: 'B', status: 'draft' },
      { title: 'C', status: 'published' },
    ]);
    const res = await content.list('posts', { filter: { status: { eq: 'published' } } });
    expect(res.items.map((e) => e.content.title).sort()).toEqual(['A', 'C']);
  });

  it('filters by IN', async () => {
    const { content } = await setupPostsWithEntries([
      { title: 'A', status: 'published' },
      { title: 'B', status: 'draft' },
      { title: 'C', status: 'scheduled' },
    ]);
    const res = await content.list('posts', { filter: { status: { in: ['published', 'scheduled'] } } });
    expect(res.items.map((e) => e.content.title).sort()).toEqual(['A', 'C']);
  });

  it('filters by date range with gte + lt', async () => {
    const { content } = await setupPostsWithEntries([
      { title: 'A', publishedAt: '2023-06-01' },
      { title: 'B', publishedAt: '2024-03-01' },
      { title: 'C', publishedAt: '2025-02-01' },
    ]);
    const res = await content.list('posts', {
      filter: { publishedAt: { gte: '2024-01-01', lt: '2025-01-01' } },
    });
    expect(res.items.map((e) => e.content.title)).toEqual(['B']);
  });

  it('filters by neq', async () => {
    const { content } = await setupPostsWithEntries([
      { title: 'A', status: 'published' },
      { title: 'B', status: 'draft' },
    ]);
    const res = await content.list('posts', { filter: { status: { neq: 'draft' } } });
    expect(res.items.map((e) => e.content.title)).toEqual(['A']);
  });

  it('filters by the top-level status column (resolver precedence)', async () => {
    // The Posts blueprint may define `status` as a content field, AND the
    // entries table has a top-level `status` column. The resolver MUST
    // prefer the top-level column when the name matches both. Verifies the
    // precedence by inserting rows whose top-level `status` matches but the
    // JSON `status` does not (or vice versa, per the test fixture).
    const { content, db } = await setupPostsWithEntries([{ title: 'A' }, { title: 'B' }]);
    // Force one row's top-level status to 'draft' (bypassing service so the
    // JSON content keeps 'published' or whatever the seed inserted).
    const ids = await db.query<{ id: string }>(
      'SELECT id FROM entries WHERE collection_handle = ?',
      ['posts'],
    );
    await db.exec(`UPDATE entries SET status = 'draft' WHERE id = ?`, [ids[0]!.id]);
    const res = await content.list('posts', { filter: { status: { eq: 'published' } } });
    // Top-level column is the source of truth — only the still-published row matches.
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.id).toBe(ids[1]!.id);
  });

  it('empty IN returns no items', async () => {
    const { content } = await setupPostsWithEntries([{ title: 'A' }]);
    const res = await content.list('posts', { filter: { status: { in: [] } } });
    expect(res.items).toEqual([]);
  });

  it('combines q and filter with AND', async () => {
    const { content } = await setupPostsWithEntries([
      { title: 'Climate report', status: 'published' },
      { title: 'Climate report', status: 'draft' },
      { title: 'Music', status: 'published' },
    ]);
    const res = await content.list('posts', {
      q: 'climate',
      field: 'title',
      filter: { status: { eq: 'published' } },
    });
    expect(res.items.map((e) => e.content.title)).toEqual(['Climate report']);
    // Only one row matches both.
  });

  it('sorts by single content field descending', async () => {
    const { content } = await setupPostsWithEntries([
      { title: 'A', publishedAt: '2024-03-01' },
      { title: 'B', publishedAt: '2024-01-01' },
      { title: 'C', publishedAt: '2024-02-01' },
    ]);
    const res = await content.list('posts', {
      sort: [{ field: 'publishedAt', direction: 'desc' }],
    });
    expect(res.items.map((e) => e.content.title)).toEqual(['A', 'C', 'B']);
  });

  it('sorts by multiple fields in declared order', async () => {
    const { content } = await setupPostsWithEntries([
      { title: 'C', publishedAt: '2024-01-01' },
      { title: 'A', publishedAt: '2024-01-01' },
      { title: 'B', publishedAt: '2024-02-01' },
    ]);
    const res = await content.list('posts', {
      sort: [
        { field: 'publishedAt', direction: 'asc' },
        { field: 'title', direction: 'asc' },
      ],
    });
    expect(res.items.map((e) => e.content.title)).toEqual(['A', 'C', 'B']);
  });

  it('falls back to default sort when sort is omitted', async () => {
    const { content } = await setupPostsWithEntries([{ title: 'A' }, { title: 'B' }]);
    const res = await content.list('posts');
    // Default: sort_order ASC, created_at DESC. With sort_order assigned
    // monotonically on insert, the insertion order is preserved.
    expect(res.items.map((e) => e.content.title)).toEqual(['A', 'B']);
  });

  it('rejects unknown filter field with ValidationError', async () => {
    const { content } = await setupPostsWithEntries([{ title: 'A' }]);
    await expect(
      content.list('posts', { filter: { totally_unknown: { eq: 'x' } } }),
    ).rejects.toThrow();
  });

  it('rejects unknown sort field with ValidationError', async () => {
    const { content } = await setupPostsWithEntries([{ title: 'A' }]);
    await expect(
      content.list('posts', { sort: [{ field: 'nope', direction: 'asc' }] }),
    ).rejects.toThrow();
  });
});
```

**Note on setup**: read the existing `service.test.ts` to find how it
seeds blueprints + entries (it likely has a `setup()` or
`createTestService()` helper). Adapt `setupPostsWithEntries(...)` to
that pattern. The Posts blueprint must include the fields used here:
`title` (text), `status` (select with options including 'published',
'draft', 'scheduled'), `publishedAt` (date), `featured` (boolean).

- [ ] **Step 2: Verify tests fail**

```bash
cd /home/espen/jsdev/vulsecms
pnpm --filter @vulse/core test -- service.test
```

Expected: the new tests FAIL because `filter` / `sort` are not yet
consumed by `list()`.

- [ ] **Step 3: Modify `list()` to use the builders**

In `packages/core/src/content/service.ts`:

Add imports at top:

```ts
import { buildFilterSql, buildOrderSql } from './filter-sql.js';
```

Replace the `list` method body (the existing implementation already
chains `search.sql` into `whereSql`; add `filter` after it and swap
the hard-coded ORDER BY):

```ts
async list(handle, opts = {}) {
  const b = blueprint(handle);
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 500));
  const offset = Math.max(0, opts.offset ?? 0);
  const search = buildSearchSql(b, opts);
  const filter = buildFilterSql(opts.filter, b);
  const order = buildOrderSql(opts.sort, b);
  const protectedClause = opts.includeProtected ? '' : ' AND protected = 0';
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
  const whereSql = `WHERE collection_handle = ?${protectedClause}${parentClause}${search.sql}${filter.sql}`;
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
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @vulse/core test -- service.test
```

Expected: all PASS (existing + new).

- [ ] **Step 5: Run all core tests + typecheck**

```bash
pnpm --filter @vulse/core test
pnpm --filter @vulse/core check
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/content/service.ts packages/core/src/content/service.test.ts
git commit -m "feat(core): list() honors filter + sort options"
```

---

# Phase B — REST query string

End state: `GET /api/collections/:handle?filter[status][eq]=...&sort=-publishedAt`
parses correctly, threads into `content.list`, returns the filtered
+ sorted results. Unknown fields → 400.

---

## Task B1: Query-string parser

**Files:**
- Create: `packages/core/src/http/filter-parser.ts`
- Create: `packages/core/src/http/__tests__/filter-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/http/__tests__/filter-parser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../errors.js';
import { parseListQuery } from '../filter-parser.js';

describe('parseListQuery', () => {
  it('returns empty filter/sort when query is empty', () => {
    expect(parseListQuery({})).toEqual({ filter: undefined, sort: undefined });
  });

  it('parses a single eq filter', () => {
    expect(parseListQuery({ 'filter[status][eq]': 'published' })).toEqual({
      filter: { status: { eq: 'published' } },
      sort: undefined,
    });
  });

  it('parses IN with comma-separated values', () => {
    expect(parseListQuery({ 'filter[status][in]': 'published,scheduled' })).toEqual({
      filter: { status: { in: ['published', 'scheduled'] } },
      sort: undefined,
    });
  });

  it('merges multiple operators on one field', () => {
    expect(
      parseListQuery({
        'filter[publishedAt][gte]': '2024-01-01',
        'filter[publishedAt][lt]': '2025-01-01',
      }),
    ).toEqual({
      filter: { publishedAt: { gte: '2024-01-01', lt: '2025-01-01' } },
      sort: undefined,
    });
  });

  it('parses sort with minus prefix as desc', () => {
    expect(parseListQuery({ sort: '-publishedAt' })).toEqual({
      filter: undefined,
      sort: [{ field: 'publishedAt', direction: 'desc' }],
    });
  });

  it('parses multi-sort comma-separated', () => {
    expect(parseListQuery({ sort: '-publishedAt,title' })).toEqual({
      filter: undefined,
      sort: [
        { field: 'publishedAt', direction: 'desc' },
        { field: 'title', direction: 'asc' },
      ],
    });
  });

  it('throws ValidationError on malformed filter key', () => {
    // No operator
    expect(() => parseListQuery({ 'filter[status]': 'published' })).toThrow(ValidationError);
    // Unknown operator
    expect(() => parseListQuery({ 'filter[status][bogus]': 'x' })).toThrow(ValidationError);
    // Junk
    expect(() => parseListQuery({ 'filter[][eq]': 'x' })).toThrow(ValidationError);
  });

  it('throws ValidationError on empty sort segment', () => {
    expect(() => parseListQuery({ sort: '' })).toThrow(ValidationError);
    expect(() => parseListQuery({ sort: '-' })).toThrow(ValidationError);
  });

  it('ignores other query params (limit, offset, q, field)', () => {
    expect(
      parseListQuery({
        limit: '20',
        offset: '0',
        q: 'climate',
        field: 'title',
        'filter[status][eq]': 'published',
      }),
    ).toEqual({
      filter: { status: { eq: 'published' } },
      sort: undefined,
    });
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
cd /home/espen/jsdev/vulsecms
pnpm --filter @vulse/core test -- filter-parser
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `parseListQuery`**

Create `packages/core/src/http/filter-parser.ts`:

```ts
import { ValidationError } from '../errors.js';
import type { FieldFilter, FilterValue, SortSpec } from '../content/types.js';

const VALID_OPS = new Set<keyof FieldFilter>(['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte']);

const FILTER_KEY_RE = /^filter\[([^\[\]]+)\]\[([a-z]+)\]$/;

export interface ParsedListQuery {
  filter: Record<string, FieldFilter> | undefined;
  sort: SortSpec[] | undefined;
}

export function parseListQuery(query: Record<string, string>): ParsedListQuery {
  const filter: Record<string, FieldFilter> = {};
  let sort: SortSpec[] | undefined;
  let sawFilter = false;

  for (const [rawKey, rawValue] of Object.entries(query)) {
    if (rawKey === 'sort') {
      sort = parseSort(rawValue);
      continue;
    }
    if (!rawKey.startsWith('filter')) continue;
    const match = FILTER_KEY_RE.exec(rawKey);
    if (!match) {
      throw new ValidationError([
        { code: 'custom', message: `Malformed filter key: ${rawKey}`, path: ['filter'] },
      ]);
    }
    const [, field, op] = match;
    if (!field) {
      throw new ValidationError([
        { code: 'custom', message: `Empty field in filter key: ${rawKey}`, path: ['filter'] },
      ]);
    }
    if (!VALID_OPS.has(op as keyof FieldFilter)) {
      throw new ValidationError([
        {
          code: 'custom',
          message: `Unknown filter operator '${op}' for field '${field}'.`,
          path: ['filter', field],
        },
      ]);
    }
    const bucket = (filter[field] ??= {});
    if (op === 'in') {
      const values = rawValue
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      (bucket as FieldFilter).in = values as FilterValue[];
    } else {
      (bucket as Record<string, FilterValue>)[op] = rawValue;
    }
    sawFilter = true;
  }

  return {
    filter: sawFilter ? filter : undefined,
    sort,
  };
}

function parseSort(raw: string): SortSpec[] {
  if (!raw || raw.trim() === '') {
    throw new ValidationError([
      { code: 'custom', message: 'Empty sort value.', path: ['sort'] },
    ]);
  }
  const segments = raw.split(',').map((s) => s.trim());
  return segments.map((seg) => {
    if (!seg || seg === '-') {
      throw new ValidationError([
        { code: 'custom', message: `Empty sort segment in '${raw}'.`, path: ['sort'] },
      ]);
    }
    const descending = seg.startsWith('-');
    const field = descending ? seg.slice(1) : seg;
    if (!field) {
      throw new ValidationError([
        { code: 'custom', message: `Empty sort field in '${seg}'.`, path: ['sort'] },
      ]);
    }
    return { field, direction: descending ? 'desc' : 'asc' };
  });
}
```

- [ ] **Step 4: Verify pass**

```bash
pnpm --filter @vulse/core test -- filter-parser
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/filter-parser.ts packages/core/src/http/__tests__/filter-parser.test.ts
git commit -m "feat(core): parseListQuery for bracket-nested filter[][] and sort=- syntax"
```

---

## Task B2: Wire parser into `GET /api/collections/:handle`

**Files:**
- Modify: `packages/core/src/http/api.ts`
- Modify: `packages/core/src/http/__tests__/api.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/http/__tests__/api.test.ts` inside the
existing `describe` block (or add a new one if cleaner):

```ts
it('GET /api/collections/:handle honors filter[status][eq]', async () => {
  const { app, db, cookie } = await setup();
  // Seed 2 entries: one published, one draft.
  await seedPost(db, 'posts', { title: 'A', status: 'published' });
  await seedPost(db, 'posts', { title: 'B', status: 'draft' });

  const res = await app.request(
    'http://x/api/collections/posts?filter[status][eq]=published',
    { headers: { cookie } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: { content: { title: string } }[] };
  expect(body.items.map((e) => e.content.title)).toEqual(['A']);
});

it('GET /api/collections/:handle honors sort=-publishedAt', async () => {
  const { app, db, cookie } = await setup();
  await seedPost(db, 'posts', { title: 'A', publishedAt: '2024-01-01' });
  await seedPost(db, 'posts', { title: 'B', publishedAt: '2024-02-01' });

  const res = await app.request(
    'http://x/api/collections/posts?sort=-publishedAt',
    { headers: { cookie } },
  );
  const body = (await res.json()) as { items: { content: { title: string } }[] };
  expect(body.items.map((e) => e.content.title)).toEqual(['B', 'A']);
});

it('GET /api/collections/:handle returns 400 on unknown filter field', async () => {
  const { app, cookie } = await setup();
  const res = await app.request(
    'http://x/api/collections/posts?filter[nope][eq]=x',
    { headers: { cookie } },
  );
  expect(res.status).toBe(400);
});

it('GET /api/collections/:handle returns 400 on malformed filter key', async () => {
  const { app, cookie } = await setup();
  const res = await app.request(
    'http://x/api/collections/posts?filter[status]=published',
    { headers: { cookie } },
  );
  expect(res.status).toBe(400);
});
```

The `setup()` helper and `seedPost(...)` shape should mirror the
existing api.test.ts fixtures. If `seedPost` doesn't exist, write a
small helper inside the test file that INSERTs via the adapter
matching the existing helper pattern.

- [ ] **Step 2: Verify failure**

```bash
cd /home/espen/jsdev/vulsecms
pnpm --filter @vulse/core test -- http/__tests__/api.test
```

Expected: the new tests FAIL.

- [ ] **Step 3: Wire `parseListQuery` into the list handler**

In `packages/core/src/http/api.ts`, find the `GET /api/collections/:handle`
handler. Add the import at top:

```ts
import { parseListQuery } from './filter-parser.js';
```

In the list handler body, replace the existing options object with
one that includes filter + sort. The current handler resembles:

```ts
const limit = Number(c.req.query('limit') ?? '25');
const offset = Number(c.req.query('offset') ?? '0');
const q = c.req.query('q') ?? undefined;
const field = c.req.query('field') ?? undefined;
return c.json(await content.list(handle, { limit, offset, q, field, includeProtected }));
```

Change to:

```ts
const limit = Number(c.req.query('limit') ?? '25');
const offset = Number(c.req.query('offset') ?? '0');
const q = c.req.query('q') ?? undefined;
const field = c.req.query('field') ?? undefined;

// c.req.queries() returns Record<string, string[]>. We use the flat single-value
// view; bracket-nested keys are still string keys in this map.
const flatQuery: Record<string, string> = {};
for (const [k, vs] of Object.entries(c.req.queries())) {
  if (vs.length > 0) flatQuery[k] = vs[0]!;
}
const { filter, sort } = parseListQuery(flatQuery);

return c.json(
  await content.list(handle, {
    limit,
    offset,
    q,
    field,
    filter,
    sort,
    includeProtected,
  }),
);
```

(Adapt to the exact API of `c.req.query()` / `c.req.queries()` in the
installed Hono version. If only `c.req.query()` is available, iterate
the raw URL's `searchParams` instead. The point: get a
`Record<string, string>` keyed by raw query keys including the
bracket-nested ones.)

The existing `onError` handler in `createApi` already maps
`ValidationError` thrown anywhere in the chain to a 400 response. If
it doesn't (read the file to confirm), the `try/catch` around
`parseListQuery` + `content.list` must catch `ValidationError` and
return `c.json({error: 'validation', issues: err.issues}, 400)`.

- [ ] **Step 4: Verify pass**

```bash
pnpm --filter @vulse/core test
pnpm --filter @vulse/core check
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/api.ts packages/core/src/http/__tests__/api.test.ts
git commit -m "feat(core): GET /api/collections/:handle accepts filter + sort query params"
```

---

# Phase C — Site renderer

End state: `SiteRouteOverride` accepts `filter` and `sort`, the
renderer threads them into `content.list`, a render test confirms
end-to-end.

---

## Task C1: Extend `SiteRouteOverride` and `resolveOverride`

**Files:**
- Modify: `packages/site/src/types.ts`
- Modify: `packages/site/src/server/middleware/render.ts`
- Modify: `packages/site/src/server/middleware/render.test.ts`

- [ ] **Step 1: Extend the override type**

In `packages/site/src/types.ts`, add the imports:

```ts
import type { FieldFilter, SortSpec } from '@vulse/core';
```

Extend `SiteRouteOverride`:

```ts
export interface SiteRouteOverride {
  collection: string;
  id?: string;
  slug?: string;
  list?: boolean;
  filter?: Record<string, FieldFilter>;
  sort?: SortSpec[];
}
```

(Preserve any fields already present in the type; only add the two
new optional ones.)

- [ ] **Step 2: Write the failing test**

In `packages/site/src/server/middleware/render.test.ts`, append:

```ts
it('resolveSiteRequest with a route override + filter returns only matching entries', async () => {
  const { deps } = await setupSite([
    { collection: 'posts', content: { title: 'A', status: 'published' } },
    { collection: 'posts', content: { title: 'B', status: 'draft' } },
  ]);
  deps.routes = {
    '/blog': {
      collection: 'posts',
      list: true,
      filter: { status: { eq: 'published' } },
    },
  };
  const { status, state } = await resolveSiteRequest(deps, new URL('http://x/blog'));
  expect(status).toBe(200);
  expect(state.route.type).toBe('list');
  expect(state.entries.map((e) => e.content.title)).toEqual(['A']);
});
```

The exact `setupSite(...)` shape depends on what's already in
render.test.ts. Match the existing fixture pattern. If `setupSite`
doesn't exist, look at how the existing tests build `deps` (with a
LibsqlAdapter, blueprints map, content service) and follow that
pattern.

- [ ] **Step 3: Verify failure**

```bash
cd /home/espen/jsdev/vulsecms
pnpm --filter @vulse/site test
```

Expected: the new test FAILS because `resolveOverride` doesn't yet
forward `filter`/`sort`.

- [ ] **Step 4: Thread filter + sort into `resolveOverride`**

In `packages/site/src/server/middleware/render.ts`, modify
`resolveOverride` — the `list: true` branch currently calls
`content.list(override.collection, { limit, includeProtected: preview })`.
Add filter + sort:

```ts
if (override.list) {
  const result = await deps.content.list(override.collection, {
    limit: 100,
    includeProtected: preview,
    ...(override.filter ? { filter: override.filter } : {}),
    ...(override.sort ? { sort: override.sort } : {}),
  });
  return {
    route: { type: 'list', collection: override.collection },
    blueprints,
    entry: null,
    entries: result.items,
  };
}
```

(The conditional spread is to satisfy `exactOptionalPropertyTypes`.)

- [ ] **Step 5: Verify pass**

```bash
pnpm --filter @vulse/site test
pnpm --filter @vulse/site check
pnpm --filter @vulse/site build
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/site/src/types.ts packages/site/src/server/middleware/render.ts packages/site/src/server/middleware/render.test.ts
git commit -m "feat(site): SiteRouteOverride supports filter and sort"
```

---

# Phase D — Developer docs

End state: `docs/site.md` documents the structured filtering API
(REST + service + site override), with runnable examples. The
"Planned features" section is updated — G1 (structured filtering)
moves out of Planned into a real section. The `?preview=1` security
note stays but is reclassified as "Fixed" (since the previous task
already addressed it).

---

## Task D1: Update `docs/site.md`

**Files:**
- Modify: `docs/site.md`

- [ ] **Step 1: Replace the "Known limitations" subsection**

In `docs/site.md`, find the current "Known limitations (today)"
subsection inside section 3 ("Querying and filtering collections").
That whole block claims structured filtering isn't available and
shows workarounds. Replace it with a real Filtering subsection:

```markdown
### Structured filtering and sorting

`content.list(handle, opts)` supports a strict set of operators on
both top-level columns (`id`, `status`, `protected`, `parent_id`,
`created_at`, `updated_at`, `sort_order`) and any declared blueprint
field.

#### Operators

| Op | SQL | Meaning |
| --- | --- | --- |
| `eq` | `=` | exact match |
| `neq` | `!=` | not equal |
| `in` | `IN (…)` | any of |
| `gt`, `gte`, `lt`, `lte` | `>`, `>=`, `<`, `<=` | comparison (lex on strings, numeric on numeric cols) |

Operators inside one field AND together
(`{gte: '2024-01-01', lt: '2025-01-01'}` is "within 2024"). Filters
across different fields AND together. Empty `in: []` matches nothing.

#### From the content service

```ts
const result = await content.list('posts', {
  filter: {
    status: { in: ['published', 'scheduled'] },
    publishedAt: { gte: '2024-01-01' },
  },
  sort: [{ field: 'publishedAt', direction: 'desc' }],
  limit: 20,
});
```

#### From the REST API

Bracket-nested filter syntax + comma-separated values for `in`:

```
GET /api/collections/posts
  ?filter[status][in]=published,scheduled
  &filter[publishedAt][gte]=2024-01-01
  &sort=-publishedAt
  &limit=20
```

Sort accepts comma-separated fields; prefix with `-` for descending.

#### From a `SiteRouteOverride`

Pre-configure filtered routes in your `vulse.config.ts`:

```ts
export default {
  routes: {
    '/blog': {
      collection: 'posts',
      list: true,
      filter: { status: { eq: 'published' } },
      sort: [{ field: 'publishedAt', direction: 'desc' }],
    },
  },
};
```

#### Error responses

| Status | Body | When |
| --- | --- | --- |
| 400 | `{error: 'unknown_filter_field', field}` | filter key isn't a top-level column or declared blueprint field |
| 400 | `{error: 'unknown_sort_field', field}` | sort key isn't a top-level column or declared blueprint field |
| 400 | `{error: 'invalid_filter_value', field, op}` | value can't be coerced (e.g. `gt` on a boolean field) |
| 400 | `{error: 'malformed_filter'}` | query string doesn't match `filter[<field>][<op>]=…` |

Strict 400 is intentional — silently ignoring a typo would return
more data than you asked for, which is the worst kind of correctness
bug.

#### Index coverage

Filters on top-level columns (especially `status` and `protected`)
hit the existing indexes. Filters on content fields run
`json_extract` per row; that's fine for the entry sizes Vulse
handles today (single-machine libsql, thousands per collection).
Heavy content-field filtering at scale would want a dedicated
indexed-column migration.
```

- [ ] **Step 2: Update the "Planned features" section**

In the same file, find the "Planned features" / "Backend gaps"
section. Remove the bullet about structured filtering (G1) entirely
— it just shipped. Also flip the `?preview=1` bullet to note the
fix landed (or remove if a recent commit already updated this).

If the doc lists planned items numbered or as headings, remove
"Structured filtering on collections" and renumber neighbors. Keep
the SEO and `/login` items.

- [ ] **Step 3: Update the "Querying entries imperatively" snippet**

The doc's earlier section that says "To filter by `status ===
'published'` today: post-filter the array client-side or via a
custom route override that runs SQL through the adapter" — DELETE
that workaround paragraph. Replace it with a single sentence that
points down to the new "Structured filtering and sorting" subsection.

- [ ] **Step 4: Spot-check by reading the whole doc end-to-end**

Confirm:
- Nothing else claims filtering is missing or that workarounds are
  needed.
- The new operator table and examples have no typos.
- All code blocks have matching language hints.

- [ ] **Step 5: Commit**

```bash
git add docs/site.md
git commit -m "docs(site): document structured filtering + sorting API"
```

---

## Final verification

- [ ] **Run the full workspace gate**

```bash
cd /home/espen/jsdev/vulsecms
pnpm -r build
pnpm -r test
pnpm -r --filter '!@vulse/dev' run check
pnpm biome check .
```

Expected: clean across all packages.

- [ ] **Manual smoke check**

```bash
rm -f apps/dev/dev.db apps/dev/dev.db-shm apps/dev/dev.db-wal
pnpm dev
```

Sign in. Create a few Posts with different `status` values
(`published`, `draft`). Then:

```bash
SUPER_COOKIE='...'   # capture from a sign-in response

curl -s "http://localhost:5173/api/collections/posts?filter[status][eq]=published" \
  -H "cookie: $SUPER_COOKIE" | jq '.items | length'

curl -s "http://localhost:5173/api/collections/posts?sort=-publishedAt" \
  -H "cookie: $SUPER_COOKIE" | jq '.items[].content.publishedAt'

curl -s "http://localhost:5173/api/collections/posts?filter[totally_unknown][eq]=x" \
  -H "cookie: $SUPER_COOKIE" -i | head -1
# Expected: HTTP/1.1 400
```

- [ ] **Cleanup**

If you used TaskCreate to track tasks, mark them all complete.
