# Structured filtering on collection lists — Design

Date: 2026-05-18
Status: Approved

## Problem

`ContentService.list` supports substring search (`q + field`) and
pagination, but no structured filtering or ordering. Real CMS use cases
that Vulse can't express today:

- "Posts where `status = 'published'`"
- "Posts where `category` is one of `howto`, `guide`"
- "Posts published since 2024-01-01, newest first"

The substring search overlaps awkwardly with these — `q=published` on
the `status` field happens to work, but it matches substrings, doesn't
combine cleanly with multi-field filters, and silently ignores the
intent. Real applications using Vulse today either pull a wide page
and post-filter in JS, or hand-write SQL through the libsql adapter.
Neither scales, both invite bugs.

## Goals

- Express equality, "any of", and comparison filters on top-level
  columns and blueprint-declared fields.
- Order by one or more fields in either direction.
- Combine filters and sort with the existing `q`, `limit`, `offset`,
  and `includeProtected` options. Old call sites keep working
  unchanged.
- Surface the same capability through the REST API and the site
  renderer's `SiteRouteOverride`, so site consumers can pre-configure
  filtered lists in their config.
- Strict validation — unknown filter fields return 400 (not silent
  drop) so typos don't quietly return more data than intended.

## Non-goals (v1)

- Logical `OR` / arbitrary predicate trees (`(A AND B) OR C`). All
  filters AND together.
- Joins across entries (filter on a relationship target's fields).
- `like` / `contains` operators — `q + field` substring search keeps
  that role.
- Relative date helpers (`now-7d`, `gte=today`).
- Admin SPA UI for building filter URLs. This lands the API; the admin
  can adopt it incrementally later.

## Internal service API

`packages/core/src/content/types.ts` extends `ListEntriesOptions`:

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

export interface ListEntriesOptions {
  limit?: number;
  offset?: number;
  q?: string;
  field?: string;
  includeProtected?: boolean;
  filter?: Record<string, FieldFilter>;
  sort?: SortSpec[];
}
```

Operators within one `FieldFilter` AND together: `{gte: '2024-01-01',
lt: '2025-01-01'}` matches "within 2024". Filters across different
fields AND together. Multiple sorts apply in declaration order. `q +
filter` AND together; `q` substring search behavior unchanged.

## Allowed filter and sort keys

A key is filterable / sortable if either:

1. It is a **top-level entry column**: `id`, `status`, `protected`,
   `parent_id`, `created_at`, `updated_at`, `sort_order`. These are
   indexed where it matters.
2. OR it is a **declared blueprint field name** — validated against
   `blueprint.fields[*].name`.

Unknown keys → `400 { error: 'unknown_filter_field', field: 'xyz' }`
or `'unknown_sort_field'`. Strict rejection on purpose: silent drop
hides typos that would otherwise return more data than the caller
expected.

The whitelist is also a SQL injection guard. Only declared identifiers
get interpolated into the `json_extract(content, '$.<field>')`
expression; nothing user-supplied flows into raw SQL.

## SQL construction

Inside `packages/core/src/content/service.ts`'s `list()`:

### Filter clauses

For each `(fieldKey, fieldFilter)` entry in `opts.filter`:

- **Top-level column**: `<column> <op> ?` with the value as the
  parameter. Example: `status = ?` with param `'published'`.
- **Content field** (declared blueprint field): the expression
  `json_extract(content, ?)` with `'$.<field>'` as a query parameter
  (never string-interpolated). String-ish operators cast to TEXT:
  `CAST(json_extract(content, ?) AS TEXT) = ?`. Numeric operators on
  numeric content (rare in v1 — there is no number kind yet) cast to
  REAL.
- **IN**: `<expr> IN (?, ?, ?)` with one placeholder per value.
  - Empty `in: []` → emit `0` (matches nothing). Returns 200 with
    empty `items`. This is correct semantics, not an error.
- **Multiple operators on one field**: ANDed in the SQL with extra
  `AND <expr> <op> ?` clauses.

### ORDER BY clause

If `opts.sort?.length`:
- For each `{field, direction}`, append `<expr> <DIRECTION>` to the
  ORDER BY list.
- Top-level columns: `<column> ASC|DESC`.
- Content fields: `json_extract(content, '$.<field>') ASC|DESC`.
- Comma-separated in declaration order.

If `opts.sort` is missing/empty: keep the existing default
`ORDER BY sort_order ASC, created_at DESC` for backward compatibility.

### Value coercion (incoming strings → SQL params)

Most values arrive from the REST query string as raw strings. The
service receives whatever the HTTP layer parses, but inside the
service we still normalize:

- Boolean-kind fields (and the `protected` column): `'true'`, `'1'`,
  `true`, `1` → `1`; `'false'`, `'0'`, `false`, `0` → `0`.
- `sort_order`: parsed as integer.
- Everything else: pass-through as string. ISO 8601 UTC dates sort
  lexicographically, so date comparisons work without coercion.

Invalid coercions (e.g. `gt` against a boolean field) → `400 { error:
'invalid_filter_value', field, op }`.

## REST endpoint

`GET /api/collections/:handle` accepts:

```
?filter[<field>][<op>]=<value>          # one or more
?filter[<field>][in]=v1,v2,v3           # comma-separated values
?sort=<-?<field>>(,<-?<field>>)*        # minus prefix = desc
?limit=<n>
?offset=<n>
?q=<text>
?field=<name>
```

Hono's `c.req.query()` returns flat key→value. The handler parses the
bracket-nested filter keys with a small helper inside
`packages/core/src/http/api.ts` (or a sibling file if it grows beyond
a few dozen lines). Comma-split `in` values; comma-split `sort`
segments and detect leading `-` for desc.

`/api/_meta/collections` and `GET /api/collections/:handle/:id` are
unchanged. Filtering applies to the list endpoint only.

### Wire examples

```
GET /api/collections/posts?filter[status][eq]=published&sort=-publishedAt&limit=20
GET /api/collections/posts?filter[category][in]=howto,guide
GET /api/collections/posts?filter[publishedAt][gte]=2024-01-01&filter[publishedAt][lt]=2025-01-01
GET /api/collections/posts?filter[status][in]=published,scheduled&sort=-publishedAt,title
GET /api/collections/posts?q=climate&filter[status][eq]=published
```

## Site renderer integration

`packages/site/src/types.ts` extends `SiteRouteOverride`:

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

The override is resolved in `resolveOverride()` inside
`packages/site/src/server/middleware/render.ts`. When `list: true`,
threading `filter` + `sort` into `content.list({ ..., filter, sort })`
is a one-liner. Other branches (slug/id lookups) are unchanged.

Consumers configure pre-filtered lists in `vulse.config.ts`:

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

`useEntry()` is unchanged at the consumer level — `state.entries`
already carries whatever the renderer resolved. No new client-side
composable in this iteration; runtime filtering from the browser hits
the REST API directly.

## Error responses

| HTTP | body | when |
| --- | --- | --- |
| 400 | `{error: 'unknown_filter_field', field}` | filter on a field not in the blueprint or top-level whitelist |
| 400 | `{error: 'unknown_sort_field', field}` | sort on a field not in the blueprint or whitelist |
| 400 | `{error: 'invalid_filter_value', field, op}` | type coercion failure |
| 400 | `{error: 'malformed_filter'}` | query string can't be parsed into the expected shape |
| 200 | normal list response | empty IN list, any valid filter, etc. |

## Testing

**`packages/core/src/content/service.test.ts`** gains a
`describe('list with filters and sort')` block covering:

- Each operator in isolation (`eq`, `neq`, `in`, `gt`, `gte`, `lt`,
  `lte`) on a top-level column and on a content field.
- Multi-operator on one field (`{gte, lt}` for a date range).
- Multi-field filter (status + category).
- Sort by one top-level column.
- Sort by one content field.
- Multi-sort (`sort_order` + `created_at` precedence).
- Empty `in: []` returns zero items.
- `q + filter` combination.
- Default sort preserved when `sort` omitted.

**`packages/core/src/http/__tests__/api.test.ts`** gains:

- Happy-path filter via query string returns the right items.
- Sort via `?sort=-publishedAt,title` orders correctly.
- Unknown filter field returns 400 with the documented error shape.
- Malformed query (e.g. `?filter=notobject`) returns 400.
- Existing tests still pass — backward-compat.

**`packages/site/src/server/middleware/render.test.ts`** gains:

- A route override with `filter` + `sort` returns the filtered+sorted
  entries in `state.entries`.

## Implementation phasing (informational; the plan executes this order)

- **Phase A — Types and SQL builder.** Extend `ListEntriesOptions`,
  build a small `buildFilterSql(filter, blueprint)` and
  `buildSortSql(sort, blueprint)` helper, integrate into `list()`,
  service tests.
- **Phase B — REST parser and endpoint.** Add the bracket-nested
  query-string parser, wire into the GET list handler, API tests,
  error responses.
- **Phase C — Site renderer override.** Extend `SiteRouteOverride`,
  thread filter/sort into `resolveOverride`, site tests, doc update
  in `docs/site.md`.

Each phase ends green (`pnpm -r test`, `pnpm -r check`,
`pnpm biome check .`). Total scope: ~2 days of focused work.

## Risks and open questions

1. **Index coverage.** Filters on top-level columns hit existing
   indexes (`idx_entries_scope`, `idx_entries_status`,
   `idx_entries_protected`). Filters on content fields run a full
   table scan with `json_extract` per row. Fine for the entry sizes
   Vulse handles today (single-machine libsql, thousands of entries);
   we'll revisit if anyone deploys at 100k+ entries per collection.
2. **`q` + `filter` ordering.** Existing `q` substring filter ANDs in
   after the new filter clause. Tests must cover both `q + filter`
   together and each alone to lock the order in.
3. **Boolean field encoding.** `protected` is `INTEGER 0/1`, but the
   Entry shape exposes `protected: boolean`. The coercion layer at
   the service boundary handles this; documented above.
4. **Empty `in: []` semantics.** Decided: matches nothing, no error.
   Alternative was 400 — "you probably meant something" — but most
   real callers building `in` from a user selection will pass `[]`
   when nothing is selected, and "show nothing" is the right answer.
5. **`?sort=-publishedAt` for a non-existent field.** Strict
   validation rejects it (400). No silent fallback to the default.
   Caller must catch this in their UI.
