# Drafts & Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Statamic-style draft/publish workflow to Vulse — editors can save changes that stay invisible to the public site until explicitly published, with a separate publish permission and signed-token public-site preview.

**Architecture:** Storage is a new `draft_content` column on `entries`; the existing `content` column remains the live copy that the public site renders. A new per-collection `drafts` blueprint flag opts collections in. New service methods `publish` / `unpublish` / `discardDraft` plus a `publish: boolean` opt on `create` / `update`. New `can_publish` permission. HMAC-signed preview tokens let editors view drafts on the actual public URL.

**Tech Stack:** SQLite/libSQL (raw SQL migrations), TypeScript, Vitest, Vue 3, h3 router, Zod, existing `@vulse/db` / `@vulse/core` / `@vulse/auth` / `@vulse/admin` / `@vulse/site` packages.

**Reference spec:** `docs/superpowers/specs/2026-05-19-drafts-publish-design.md`. The mutation matrix in section "Service API" of that spec is the source of truth for behaviour; refer to it when in doubt.

**Important conventions in this codebase:**

- Test framework is **Vitest**. Run a single file with `pnpm --filter @vulse/<pkg> test -- <relative-path>`. Run a single test by name with `-- -t 'pattern'`.
- Test DBs use `new LibsqlAdapter({ url: ':memory:' })` + `runMigrations(db, MIGRATIONS_DIR)`. Always `await db.close()` at the end.
- Blueprints in tests are seeded via `seedBlueprintsFromCode({ adapter, dir: fixturesDir })` from `packages/core/src/blueprints/__fixtures__/`. The `posts` collection exists; we'll add a `drafts-posts` fixture below.
- Commit messages follow conventional commits: `feat(core): …`, `fix(admin): …`, `docs(site): …`. Keep one logical change per commit.
- The dev DB at `apps/dev/dev.db` is disposable for this work — drop and re-migrate freely.

---

## File Structure

**New files:**

- `packages/db/migrations/010_drafts.sql` — schema migration.
- `packages/core/src/preview/preview-token.ts` — HMAC sign/verify.
- `packages/core/src/preview/preview-token.test.ts` — token unit tests.
- `packages/core/src/content/__tests__/drafts.test.ts` — service mutation matrix tests.
- `packages/core/src/http/__tests__/drafts.api.test.ts` — HTTP endpoint tests for the new actions.
- `packages/core/src/blueprints/__fixtures__/drafts-posts.ts` — blueprint fixture with `drafts: true`.
- `docs/drafts.md` — user-facing drafts documentation.

**Modified files:**

- `packages/db/src/schema.test.ts` — assert new columns exist.
- `packages/core/src/blueprints/definition.ts` — add `drafts: boolean` to schema.
- `packages/core/src/blueprints/types.ts` — add `drafts: boolean` to `Blueprint` type.
- `packages/core/src/blueprints/load.ts` and `compile.ts` — pass through `drafts`.
- `packages/core/src/content/types.ts` — extend `Entry` DTO, `ContentService`, `ListEntriesOptions`, add `MutationOptions`.
- `packages/core/src/content/service.ts` — extend `rowToEntry`, modify `create`/`update`/`list`, add `publish`/`unpublish`/`discardDraft`.
- `packages/core/src/content/service.test.ts` — adapt assertions that now expect new DTO fields.
- `packages/core/src/revisions/types.ts` — add `kind`.
- `packages/core/src/revisions/service.ts` — accept + persist `kind`.
- `packages/core/src/errors.ts` — confirm `ValidationError` / `ConflictError` are sufficient (no new error class needed; we reuse `ValidationError` with structured codes).
- `packages/core/src/http/api.ts` — modify entry endpoints, add `/publish`, `/unpublish`, `/draft` (DELETE), `/preview-token` endpoints.
- `packages/core/src/http/filter-parser.ts` — accept `includeDrafts`.
- `packages/core/src/index.ts` — export new symbols.
- `packages/auth/src/types.ts` — `Action` includes `'publish'`.
- `packages/auth/src/permissions.ts` — load `can_publish` column.
- `packages/auth/src/services/groups.ts` — `PermissionRowInput.canPublish`.
- `packages/auth/src/routes/groups.ts` — accept/return `canPublish`.
- `packages/auth/src/__tests__/permissions.test.ts` — extend.
- `packages/site/src/server/middleware/render.ts` — enforce published-only, add preview-token consumer.
- `packages/site/src/server/middleware/render.test.ts` — extend.
- `packages/site/src/composables/useEntry.ts` — pass through `filter`/draft context (small change).
- `packages/admin/src/api/client.ts` — extend types, add new methods.
- `packages/admin/src/pages/CollectionEntry.vue` — split Save button, status badge, Preview button.
- `packages/admin/src/pages/CollectionList.vue` — status column + filter chip.
- `packages/admin/src/pages/BlueprintEditor.vue` — drafts checkbox.
- `packages/admin/src/pages/GroupEditor.vue` — publish checkbox.
- `docs/database.md` — schema reference updates.
- `docs/auth.md` — add `publish` to actions list.

---

## Phase A — Schema & types foundation

### Task A1: Migration — schema columns

**Files:**
- Create: `packages/db/migrations/010_drafts.sql`
- Modify: `packages/db/src/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/db/src/schema.test.ts` and add a test (at the end of the existing `describe`):

```ts
it('010_drafts adds draft columns and can_publish', async () => {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);

  const entryCols = await db.query<{ name: string }>('PRAGMA table_info(entries)');
  const names = entryCols.map((c) => c.name);
  expect(names).toContain('draft_content');
  expect(names).toContain('published_at');
  expect(names).toContain('published_by');

  const permCols = await db.query<{ name: string }>('PRAGMA table_info(group_permissions)');
  expect(permCols.map((c) => c.name)).toContain('can_publish');

  const revCols = await db.query<{ name: string }>('PRAGMA table_info(revisions)');
  expect(revCols.map((c) => c.name)).toContain('kind');

  await db.close();
});

it('010_drafts backfills published_at from updated_at for published rows', async () => {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  // Insert a row that pretends to predate the migration by mimicking the old
  // shape (published_at NULL).
  await db.exec(`INSERT INTO collections (handle, label, definition) VALUES ('p','P','{}')`);
  await db.exec(
    `INSERT INTO entries (id, collection_handle, parent_id, sort_order, status, content, updated_at, published_at)
     VALUES ('e1', 'p', NULL, 1, 'published', '{}', '2024-01-01 00:00:00', NULL)`,
  );
  // Re-run the backfill UPDATE (idempotent — same statement as in the migration).
  await db.exec(
    `UPDATE entries SET published_at = updated_at WHERE status = 'published' AND published_at IS NULL`,
  );
  const row = await db.queryOne<{ published_at: string | null }>(
    'SELECT published_at FROM entries WHERE id = ?',
    ['e1'],
  );
  expect(row?.published_at).toBe('2024-01-01 00:00:00');

  await db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vulse/db test -- src/schema.test.ts`
Expected: FAIL — `draft_content` not in column list (migration doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `packages/db/migrations/010_drafts.sql`:

```sql
ALTER TABLE entries           ADD COLUMN draft_content TEXT;
ALTER TABLE entries           ADD COLUMN published_at  TEXT;
ALTER TABLE entries           ADD COLUMN published_by  TEXT;
ALTER TABLE group_permissions ADD COLUMN can_publish   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE revisions         ADD COLUMN kind          TEXT NOT NULL DEFAULT 'draft';

UPDATE entries
SET published_at = updated_at
WHERE status = 'published' AND published_at IS NULL;
```

The `runMigrations` helper picks up files alphabetically from `MIGRATIONS_DIR`; no registration needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vulse/db test -- src/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Reset the dev database**

Run from `apps/dev/`:

```bash
rm -f apps/dev/dev.db
pnpm --filter @vulse/dev predev   # rebuild package deps so migrations run on next dev start
```

(Migrations will re-apply on next `pnpm dev`.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/010_drafts.sql packages/db/src/schema.test.ts
git commit -m "feat(db): 010_drafts adds draft_content, published_at, can_publish, revisions.kind"
```

---

### Task A2: Blueprint `drafts` flag

**Files:**
- Modify: `packages/core/src/blueprints/definition.ts`
- Modify: `packages/core/src/blueprints/types.ts`
- Modify: `packages/core/src/blueprints/load.ts`
- Modify: `packages/core/src/blueprints/compile.ts`
- Modify: `packages/core/src/blueprints/definition.test.ts`

- [ ] **Step 1: Locate compile + load**

Read `packages/core/src/blueprints/compile.ts` and `load.ts` to find where `singleton`, `tree`, `maxDepth` are passed through. The new `drafts` flag follows the exact same shape.

- [ ] **Step 2: Write the failing test**

Append to `packages/core/src/blueprints/definition.test.ts`:

```ts
it('accepts a drafts: true blueprint', () => {
  const result = BlueprintDefinitionSchema.safeParse({
    handle: 'posts',
    label: 'Posts',
    singleton: false,
    drafts: true,
    fields: [{ name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false }],
  });
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.drafts).toBe(true);
});

it('defaults drafts to false when omitted', () => {
  const result = BlueprintDefinitionSchema.safeParse({
    handle: 'posts',
    label: 'Posts',
    singleton: false,
    fields: [{ name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false }],
  });
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.drafts).toBe(false);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @vulse/core test -- src/blueprints/definition.test.ts -t drafts`
Expected: FAIL — schema rejects/omits the `drafts` field.

- [ ] **Step 4: Add `drafts` to the schema**

In `packages/core/src/blueprints/definition.ts`, modify `BlueprintDefinitionObjectSchema`:

```ts
const BlueprintDefinitionObjectSchema = z.object({
  handle: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  label: z.string().min(1),
  singleton: z.boolean(),
  tree: z.boolean().optional(),
  maxDepth: z.number().int().positive().optional(),
  drafts: z.boolean().default(false),
  fields: z.array(FieldDefinitionSchema).min(1),
});
```

- [ ] **Step 5: Add `drafts` to the runtime type**

In `packages/core/src/blueprints/types.ts`:

```ts
export interface Blueprint {
  handle: string;
  label: string;
  singleton: boolean;
  tree: boolean;
  maxDepth?: number;
  drafts: boolean;
  schema: z.ZodObject<z.ZodRawShape>;
  fields: FieldDefinition[];
  hash: string;
}
```

- [ ] **Step 6: Pass `drafts` through compile/load**

In `packages/core/src/blueprints/compile.ts`, wherever the function builds the `Blueprint` object from the definition (look for a literal that includes `singleton:`), add `drafts: def.drafts ?? false,` alongside.

In `packages/core/src/blueprints/load.ts`, mirror the same change for the per-row construction.

- [ ] **Step 7: Run the test**

Run: `pnpm --filter @vulse/core test -- src/blueprints/definition.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the full blueprint suite to catch regressions**

Run: `pnpm --filter @vulse/core test -- src/blueprints`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/blueprints/
git commit -m "feat(core): drafts: true blueprint flag (default false)"
```

---

### Task A3: Add `drafts-posts` blueprint fixture

**Files:**
- Create: `packages/core/src/blueprints/__fixtures__/drafts-posts.ts`

Used by the service + HTTP tests in Phases B/C.

- [ ] **Step 1: Copy the shape of an existing fixture**

Read `packages/core/src/blueprints/__fixtures__/posts.ts` to see the export shape.

- [ ] **Step 2: Create the fixture**

```ts
// packages/core/src/blueprints/__fixtures__/drafts-posts.ts
import { Collection } from '../collection.js';

export default Collection('drafts-posts', {
  label: 'Drafts Posts',
  drafts: true,
  fields: [
    { name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false },
    { name: 'slug', label: 'Slug', ui: { kind: 'text' }, optional: false },
  ],
});
```

If `Collection` doesn't yet accept `drafts`, extend the helper similarly to how it accepts `singleton`/`tree`. Look at `packages/core/src/blueprints/collection.ts` and add `drafts?: boolean` to its options, passing it into the returned definition.

- [ ] **Step 3: Sanity-check that the fixture seeds**

Run: `pnpm --filter @vulse/core test -- src/blueprints/seed.test.ts`
Expected: PASS — seeds without error.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/blueprints/
git commit -m "test(core): drafts-posts blueprint fixture"
```

---

### Task A4: Auth `publish` action

**Files:**
- Modify: `packages/auth/src/types.ts`
- Modify: `packages/auth/src/permissions.ts`
- Modify: `packages/auth/src/__tests__/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/auth/src/__tests__/permissions.test.ts`, find an existing test that inserts a `group_permissions` row, then add:

```ts
it('surfaces can_publish=1 as the publish action', async () => {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  // Seed minimal user + group + perm row.
  await db.exec(`INSERT INTO users (id, email, email_verified, role, is_super)
                 VALUES ('u1','a@b.c',1,'editor',0)`);
  await db.exec(`INSERT INTO groups (id, handle, label) VALUES ('g1','editors','Editors')`);
  await db.exec(`INSERT INTO user_groups (user_id, group_id) VALUES ('u1','g1')`);
  await db.exec(
    `INSERT INTO group_permissions (group_id, collection_handle, can_read, can_create, can_update, can_delete, can_publish)
     VALUES ('g1','posts',1,1,1,0,1)`,
  );

  const user = {
    id: 'u1', email: 'a@b.c', emailVerified: true, name: null, image: null,
    role: 'editor' as const, isSuper: false, createdAt: '', updatedAt: '',
  };
  const perms = await effectivePerms(user, db);
  expect(perms.get('posts')?.has('publish')).toBe(true);

  await db.close();
});
```

(Adjust import paths and the user shape to match what already exists at the top of the test file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vulse/auth test -- src/__tests__/permissions.test.ts -t 'can_publish'`
Expected: FAIL — `Action` type doesn't include `'publish'`.

- [ ] **Step 3: Extend the `Action` type**

In `packages/auth/src/types.ts`:

```ts
export type Action = 'read' | 'create' | 'update' | 'delete' | 'publish';
```

- [ ] **Step 4: Extend the SELECT + mapping in `permissions.ts`**

In `packages/auth/src/permissions.ts`:

```ts
interface PermRow {
  collection_handle: string;
  can_read: number;
  can_create: number;
  can_update: number;
  can_delete: number;
  can_publish: number;
}

// In the SELECT:
const rows = await adapter.query<PermRow>(
  `SELECT gp.collection_handle, gp.can_read, gp.can_create, gp.can_update, gp.can_delete, gp.can_publish
   FROM user_groups ug
   JOIN group_permissions gp ON gp.group_id = ug.group_id
   WHERE ug.user_id = ?`,
  [user.id],
);

// In the row → set loop:
if (r.can_publish) set.add('publish');
```

Also extend the `isSuper` early return to grant publish:

```ts
if (user.isSuper) {
  return new Map([['*', new Set<Action>(['read', 'create', 'update', 'delete', 'publish'])]]);
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @vulse/auth test -- src/__tests__/permissions.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the auth full suite**

Run: `pnpm --filter @vulse/auth test`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add packages/auth/src/
git commit -m "feat(auth): publish action wired through effectivePerms"
```

---

### Task A5: Groups service — `canPublish`

**Files:**
- Modify: `packages/auth/src/services/groups.ts`
- Modify: `packages/auth/src/routes/groups.ts`
- Modify: `packages/auth/src/__tests__/groups.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/auth/src/__tests__/groups.test.ts`, add:

```ts
it('round-trips canPublish through setPermissions/getGroup', async () => {
  const db = await setupAuthDb();        // existing helper in the file
  const g = await createGroup(db, { handle: 'editors', label: 'Editors' });
  await setPermissions(db, g.id, [{
    collectionHandle: 'posts',
    canRead: true, canCreate: true, canUpdate: true, canDelete: false, canPublish: true,
  }]);
  const reloaded = await getGroup(db, 'editors');
  expect(reloaded?.permissions[0]?.canPublish).toBe(true);
  await db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vulse/auth test -- src/__tests__/groups.test.ts -t canPublish`
Expected: FAIL — `canPublish` not on `PermissionRowInput`.

- [ ] **Step 3: Extend the service**

In `packages/auth/src/services/groups.ts`:

```ts
export interface PermissionRowInput {
  collectionHandle: string;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canPublish: boolean;
}

// Inside loadPerms:
const rows = await adapter.query<{
  collection_handle: string;
  can_read: number; can_create: number; can_update: number; can_delete: number; can_publish: number;
}>(
  `SELECT collection_handle, can_read, can_create, can_update, can_delete, can_publish
   FROM group_permissions WHERE group_id = ? ORDER BY collection_handle`,
  [groupId],
);
return rows.map((r) => ({
  collectionHandle: r.collection_handle,
  canRead: r.can_read === 1,
  canCreate: r.can_create === 1,
  canUpdate: r.can_update === 1,
  canDelete: r.can_delete === 1,
  canPublish: r.can_publish === 1,
}));

// Inside setPermissions INSERT:
await adapter.exec(
  `INSERT INTO group_permissions
     (group_id, collection_handle, can_read, can_create, can_update, can_delete, can_publish)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [groupId, r.collectionHandle,
   r.canRead ? 1 : 0, r.canCreate ? 1 : 0,
   r.canUpdate ? 1 : 0, r.canDelete ? 1 : 0,
   r.canPublish ? 1 : 0],
);
```

- [ ] **Step 4: Update the HTTP route validation**

In `packages/auth/src/routes/groups.ts`, find the Zod schema used for `PATCH /groups/:handle/permissions` (or wherever permissions are accepted). Add `canPublish: z.boolean()` to the row schema. If the schema currently uses `z.object({ ..., canDelete: z.boolean() })`, add the new field alongside.

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @vulse/auth test -- src/__tests__/groups.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/auth/src/
git commit -m "feat(auth): groups service round-trips canPublish"
```

---

## Phase B — Content service

### Task B1: `Entry` DTO + types extension

**Files:**
- Modify: `packages/core/src/content/types.ts`

- [ ] **Step 1: Edit the types**

Replace the `Entry` interface with:

```ts
export interface Entry {
  id: string;
  collection: string;
  parentId: string | null;
  sortOrder: number;
  status: string;
  protected: boolean;
  content: Record<string, unknown>;
  draftContent: Record<string, unknown> | null;
  hasUnpublishedChanges: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Add a mutation-options type and extend `ListEntriesOptions`:

```ts
export interface MutationOptions {
  /** Publish on save. Ignored on drafts-disabled collections. */
  publish?: boolean;
}

export interface ListEntriesOptions {
  limit?: number;
  offset?: number;
  q?: string;
  field?: string;
  includeProtected?: boolean;
  /** Include draft-status rows in the result. Default false. */
  includeDrafts?: boolean;
  parentId?: string | null;
  filter?: Record<string, FieldFilter>;
  sort?: SortSpec[];
}
```

Extend the service interface signatures:

```ts
export interface ContentService {
  list(handle: string, opts?: ListEntriesOptions): Promise<ListEntriesResult>;
  get(handle: string, id: string): Promise<Entry | null>;
  create(handle: string, input: unknown, ctx?: MutationContext, opts?: MutationOptions): Promise<Entry>;
  update(handle: string, id: string, input: unknown, ctx?: MutationContext, opts?: MutationOptions): Promise<Entry>;
  delete(handle: string, id: string): Promise<void>;
  move(handle: string, id: string, input: MoveEntryInput): Promise<Entry>;
  tree(handle: string, opts?: { includeProtected?: boolean }): Promise<EntryNode[]>;
  publish(handle: string, id: string, ctx?: MutationContext): Promise<Entry>;
  unpublish(handle: string, id: string, ctx?: MutationContext): Promise<Entry>;
  discardDraft(handle: string, id: string, ctx?: MutationContext): Promise<Entry>;
}
```

- [ ] **Step 2: Run typecheck to confirm only known surfaces break**

Run: `pnpm --filter @vulse/core check`
Expected: errors only in `service.ts` (methods not implemented), `service.test.ts` (assertions for old shape), and downstream consumers in `http/`, `site/`. That's the blast radius for the next tasks — note them.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/content/types.ts
git commit -m "feat(core): Entry DTO grows draftContent, hasUnpublishedChanges, publishedAt, publishedBy"
```

(The implementation in `service.ts` lands in Task B2; we accept a temporarily-red typecheck between commits.)

---

### Task B2: `rowToEntry` + base shape + list filter

**Files:**
- Modify: `packages/core/src/content/service.ts`

- [ ] **Step 1: Extend the EntryRow + rowToEntry**

```ts
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
```

- [ ] **Step 2: Add includeDrafts filter to `list`**

Within `list()`, after the existing `protectedClause` line, add:

```ts
const draftsClause = opts.includeDrafts ? '' : " AND status = 'published'";
```

Then insert `${draftsClause}` into `whereSql`:

```ts
const whereSql = `WHERE collection_handle = ?${protectedClause}${draftsClause}${parentClause}${search.sql}${filter.sql}`;
```

- [ ] **Step 3: Add includeDrafts filter to `tree`**

In `tree()`, mirror the same `draftsClause` addition.

- [ ] **Step 4: Confirm existing tests still pass with the new DTO fields**

Run: `pnpm --filter @vulse/core test -- src/content/service.test.ts`
Some assertions may need `expect(entry.draftContent).toBeNull()` etc. — adjust any failing assertions to be explicit about the new fields rather than rewriting them to be permissive. Keep the existing test intent.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/content/
git commit -m "feat(core): rowToEntry returns draft + published metadata; list excludes drafts by default"
```

---

### Task B3: `create` with `publish` flag

**Files:**
- Modify: `packages/core/src/content/service.ts`
- Create: `packages/core/src/content/__tests__/drafts.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/content/__tests__/drafts.test.ts
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { describe, expect, it } from 'vitest';
import { loadBlueprints } from '../../blueprints/load.js';
import { seedBlueprintsFromCode } from '../../blueprints/seed.js';
import { ValidationError } from '../../errors.js';
import { createContentService } from '../service.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', 'blueprints', '__fixtures__');

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db, MIGRATIONS_DIR);
  await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
  const blueprints = await loadBlueprints({ adapter: db });
  const content = createContentService(db, blueprints);
  return { db, content };
}

describe('drafts — create', () => {
  it('create({ publish: false }) on drafts-enabled collection writes draft_content, content={}', async () => {
    const { db, content } = await setup();
    const entry = await content.create('drafts-posts',
      { title: 'X', slug: 'x' },
      { actor: { userId: 'u1' } },
      { publish: false },
    );
    expect(entry.status).toBe('draft');
    expect(entry.content).toEqual({});
    expect(entry.draftContent).toEqual({ title: 'X', slug: 'x' });
    expect(entry.hasUnpublishedChanges).toBe(true);
    expect(entry.publishedAt).toBeNull();
    await db.close();
  });

  it('create({ publish: true }) writes straight to content', async () => {
    const { db, content } = await setup();
    const entry = await content.create('drafts-posts',
      { title: 'Y', slug: 'y' },
      { actor: { userId: 'u1' } },
      { publish: true },
    );
    expect(entry.status).toBe('published');
    expect(entry.content).toEqual({ title: 'Y', slug: 'y' });
    expect(entry.draftContent).toBeNull();
    expect(entry.publishedAt).not.toBeNull();
    expect(entry.publishedBy).toBe('u1');
    await db.close();
  });

  it('create on drafts-disabled collection ignores publish:false (regression guard)', async () => {
    const { db, content } = await setup();
    const entry = await content.create('posts',
      { title: 'Z', body: [] },
      undefined,
      { publish: false },
    );
    expect(entry.status).toBe('published');
    expect(entry.content).toMatchObject({ title: 'Z' });
    await db.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @vulse/core test -- src/content/__tests__/drafts.test.ts -t create`
Expected: FAIL — `publish` opts not handled.

- [ ] **Step 3: Modify `create` in `service.ts`**

Replace the existing `create` method body. The drafts-enabled branch:

```ts
async create(handle, input, ctx, opts) {
  const b = blueprint(handle);
  if (b.singleton) { /* existing singleton check, unchanged */ }
  const validated = validate(b, input);
  const id = ulid();
  const parentIdInput = (input as { parentId?: string | null }).parentId ?? null;
  if (parentIdInput !== null) { /* existing parent / tree validation, unchanged */ }
  const max = await maxSortOrder(db, handle, parentIdInput);
  const sortOrder = max + 1;
  const isProtected = (input as { protected?: boolean }).protected ? 1 : 0;

  // Drafts-enabled + publish=false → write to draft_content, status=draft, content={}.
  const draftsEnabled = b.drafts;
  const publishOnCreate = !draftsEnabled || opts?.publish !== false;
  const actorId = ctx?.actor?.userId ?? null;

  if (publishOnCreate) {
    await db.exec(
      `INSERT INTO entries (id, collection_handle, parent_id, sort_order, status, protected, content, published_at, published_by)
       VALUES (?, ?, ?, ?, 'published', ?, ?, datetime('now'), ?)`,
      [id, handle, parentIdInput, sortOrder, isProtected, JSON.stringify(validated), actorId],
    );
    await snapshotRevision(db, id, validated, ctx?.actor ?? null, 'publish');
  } else {
    await db.exec(
      `INSERT INTO entries (id, collection_handle, parent_id, sort_order, status, protected, content, draft_content)
       VALUES (?, ?, ?, ?, 'draft', ?, '{}', ?)`,
      [id, handle, parentIdInput, sortOrder, isProtected, JSON.stringify(validated)],
    );
    await snapshotRevision(db, id, validated, ctx?.actor ?? null, 'draft');
  }

  const row = await db.queryOne<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
  return rowToEntry(row!);
},
```

Note: `snapshotRevision` now takes a `kind` arg. That's added in Task B6 — for this commit, temporarily call `snapshotRevision(db, id, validated, ctx?.actor ?? null)` (no kind) and add the kind argument once B6 lands. **Or** do B6 first if you prefer; the plan order is suggestive, not strict.

- [ ] **Step 4: Run the create tests**

Run: `pnpm --filter @vulse/core test -- src/content/__tests__/drafts.test.ts -t create`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/content/
git commit -m "feat(core): create() accepts publish flag on drafts-enabled collections"
```

---

### Task B4: `update` with `publish` flag

**Files:**
- Modify: `packages/core/src/content/service.ts`
- Modify: `packages/core/src/content/__tests__/drafts.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `drafts.test.ts`:

```ts
describe('drafts — update', () => {
  it('update({ publish: false }) on a published entry writes draft_content, content unchanged', async () => {
    const { db, content } = await setup();
    const created = await content.create('drafts-posts',
      { title: 'A', slug: 'a' }, undefined, { publish: true });
    const updated = await content.update('drafts-posts', created.id,
      { title: 'A2', slug: 'a' }, undefined, { publish: false });
    expect(updated.status).toBe('published');
    expect(updated.content).toEqual({ title: 'A', slug: 'a' });
    expect(updated.draftContent).toEqual({ title: 'A2', slug: 'a' });
    expect(updated.hasUnpublishedChanges).toBe(true);
    await db.close();
  });

  it('update({ publish: true }) on a published entry with a pending draft promotes', async () => {
    const { db, content } = await setup();
    const created = await content.create('drafts-posts',
      { title: 'B', slug: 'b' }, undefined, { publish: true });
    await content.update('drafts-posts', created.id,
      { title: 'B-draft', slug: 'b' }, undefined, { publish: false });
    const promoted = await content.update('drafts-posts', created.id,
      { title: 'B-final', slug: 'b' }, undefined, { publish: true });
    expect(promoted.content).toEqual({ title: 'B-final', slug: 'b' });
    expect(promoted.draftContent).toBeNull();
    expect(promoted.publishedAt).not.toBeNull();
    await db.close();
  });

  it('update({ publish: true }) on a draft entry promotes status=published', async () => {
    const { db, content } = await setup();
    const draft = await content.create('drafts-posts',
      { title: 'C', slug: 'c' }, undefined, { publish: false });
    const promoted = await content.update('drafts-posts', draft.id,
      { title: 'C', slug: 'c' }, undefined, { publish: true });
    expect(promoted.status).toBe('published');
    expect(promoted.content).toEqual({ title: 'C', slug: 'c' });
    expect(promoted.draftContent).toBeNull();
    await db.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @vulse/core test -- src/content/__tests__/drafts.test.ts -t update`
Expected: FAIL.

- [ ] **Step 3: Modify `update` in `service.ts`**

Replace the existing `update` body:

```ts
async update(handle, id, input, ctx, opts) {
  const b = blueprint(handle);
  const existing = await db.queryOne<EntryRow>(
    'SELECT * FROM entries WHERE collection_handle = ? AND id = ?',
    [handle, id],
  );
  if (!existing) throw new NotFoundError(`entry not found: ${id}`);
  // Merge against whichever copy is the "working" one: the draft if present,
  // otherwise the published content.
  const baseContent = existing.draft_content
    ? JSON.parse(existing.draft_content)
    : JSON.parse(existing.content);
  const merged = { ...baseContent, ...(input as object) };
  const validated = validate(b, merged);

  const draftsEnabled = b.drafts;
  const publishNow = !draftsEnabled || opts?.publish === true;
  const actorId = ctx?.actor?.userId ?? null;

  if (publishNow) {
    const fields = ['content = ?', "updated_at = datetime('now')"];
    const params: unknown[] = [JSON.stringify(validated)];
    if (draftsEnabled) {
      fields.push('draft_content = NULL', "status = 'published'",
                  "published_at = datetime('now')", 'published_by = ?');
      params.push(actorId);
    }
    if ('protected' in (input as object)) {
      fields.push('protected = ?');
      params.push((input as { protected: boolean }).protected ? 1 : 0);
    }
    await db.exec(`UPDATE entries SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
    await snapshotRevision(db, id, validated, ctx?.actor ?? null, 'publish');
  } else {
    // Save as draft — content untouched (unless the row is itself a draft).
    const fields = ['draft_content = ?', "updated_at = datetime('now')"];
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
```

- [ ] **Step 4: Run the update tests**

Run: `pnpm --filter @vulse/core test -- src/content/__tests__/drafts.test.ts -t update`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/content/
git commit -m "feat(core): update() accepts publish flag; draft writes don't touch content"
```

---

### Task B5: `publish`, `unpublish`, `discardDraft`

**Files:**
- Modify: `packages/core/src/content/service.ts`
- Modify: `packages/core/src/content/__tests__/drafts.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('drafts — publish/unpublish/discard', () => {
  async function makePublishedWithDraft() {
    const { db, content } = await setup();
    const e = await content.create('drafts-posts',
      { title: 'A', slug: 'a' }, undefined, { publish: true });
    await content.update('drafts-posts', e.id,
      { title: 'A-draft', slug: 'a' }, undefined, { publish: false });
    return { db, content, id: e.id };
  }

  it('publish() promotes draft_content to content', async () => {
    const { db, content, id } = await makePublishedWithDraft();
    const r = await content.publish('drafts-posts', id, { actor: { userId: 'u9' } });
    expect(r.content).toEqual({ title: 'A-draft', slug: 'a' });
    expect(r.draftContent).toBeNull();
    expect(r.publishedBy).toBe('u9');
    await db.close();
  });

  it('unpublish() moves content to draft_content', async () => {
    const { db, content } = await setup();
    const e = await content.create('drafts-posts',
      { title: 'B', slug: 'b' }, undefined, { publish: true });
    const r = await content.unpublish('drafts-posts', e.id);
    expect(r.status).toBe('draft');
    expect(r.content).toEqual({});
    expect(r.draftContent).toEqual({ title: 'B', slug: 'b' });
    expect(r.publishedAt).toBeNull();
    await db.close();
  });

  it('unpublish() on a never-published entry throws entry_already_draft', async () => {
    const { db, content } = await setup();
    const e = await content.create('drafts-posts',
      { title: 'C', slug: 'c' }, undefined, { publish: false });
    await expect(content.unpublish('drafts-posts', e.id)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'entry_already_draft' })],
    });
    await db.close();
  });

  it('discardDraft() clears draft_content on a published entry', async () => {
    const { db, content, id } = await makePublishedWithDraft();
    const r = await content.discardDraft('drafts-posts', id);
    expect(r.draftContent).toBeNull();
    expect(r.hasUnpublishedChanges).toBe(false);
    expect(r.content).toEqual({ title: 'A', slug: 'a' });
    await db.close();
  });

  it('discardDraft() on a status=draft entry throws cannot_discard_initial_draft', async () => {
    const { db, content } = await setup();
    const e = await content.create('drafts-posts',
      { title: 'D', slug: 'd' }, undefined, { publish: false });
    await expect(content.discardDraft('drafts-posts', e.id)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'cannot_discard_initial_draft' })],
    });
    await db.close();
  });

  it('discardDraft() on a published entry with no draft throws no_draft_to_discard', async () => {
    const { db, content } = await setup();
    const e = await content.create('drafts-posts',
      { title: 'E', slug: 'e' }, undefined, { publish: true });
    await expect(content.discardDraft('drafts-posts', e.id)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'no_draft_to_discard' })],
    });
    await db.close();
  });

  it('publish/unpublish/discardDraft on a drafts-disabled collection throws drafts_not_enabled', async () => {
    const { db, content } = await setup();
    const e = await content.create('posts', { title: 'P', body: [] });
    await expect(content.publish('posts', e.id)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'drafts_not_enabled' })],
    });
    await db.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @vulse/core test -- src/content/__tests__/drafts.test.ts -t publish/unpublish/discard`
Expected: FAIL — methods undefined.

- [ ] **Step 3: Implement the methods**

In `service.ts`, inside the returned object, add:

```ts
async publish(handle, id, ctx) {
  const b = blueprint(handle);
  if (!b.drafts) {
    throw new ValidationError([
      { code: 'drafts_not_enabled', message: `Collection '${handle}' does not have drafts enabled.`, path: ['handle'] },
    ]);
  }
  const row = await db.queryOne<EntryRow>(
    'SELECT * FROM entries WHERE collection_handle = ? AND id = ?', [handle, id],
  );
  if (!row) throw new NotFoundError(`entry not found: ${id}`);
  // Promote whatever's in draft_content if present; otherwise no-op publish
  // (re-stamp published_at).
  const promote = row.draft_content
    ? JSON.parse(row.draft_content)
    : JSON.parse(row.content);
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

async unpublish(handle, id, ctx) {
  const b = blueprint(handle);
  if (!b.drafts) {
    throw new ValidationError([
      { code: 'drafts_not_enabled', message: `Collection '${handle}' does not have drafts enabled.`, path: ['handle'] },
    ]);
  }
  const row = await db.queryOne<EntryRow>(
    'SELECT * FROM entries WHERE collection_handle = ? AND id = ?', [handle, id],
  );
  if (!row) throw new NotFoundError(`entry not found: ${id}`);
  if (row.status === 'draft') {
    throw new ValidationError([
      { code: 'entry_already_draft', message: 'Entry has never been published.', path: ['id'] },
    ]);
  }
  await db.exec(
    `UPDATE entries
     SET draft_content = COALESCE(draft_content, content),
         content = '{}',
         status = 'draft',
         published_at = NULL,
         published_by = NULL,
         updated_at = datetime('now')
     WHERE id = ?`,
    [id],
  );
  const updated = await db.queryOne<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
  return rowToEntry(updated!);
},

async discardDraft(handle, id, ctx) {
  const b = blueprint(handle);
  if (!b.drafts) {
    throw new ValidationError([
      { code: 'drafts_not_enabled', message: `Collection '${handle}' does not have drafts enabled.`, path: ['handle'] },
    ]);
  }
  const row = await db.queryOne<EntryRow>(
    'SELECT * FROM entries WHERE collection_handle = ? AND id = ?', [handle, id],
  );
  if (!row) throw new NotFoundError(`entry not found: ${id}`);
  if (row.status === 'draft') {
    throw new ValidationError([
      { code: 'cannot_discard_initial_draft',
        message: 'This entry has no published copy. Delete it instead.', path: ['id'] },
    ]);
  }
  if (row.draft_content === null) {
    throw new ValidationError([
      { code: 'no_draft_to_discard', message: 'Entry has no pending draft.', path: ['id'] },
    ]);
  }
  await db.exec(
    `UPDATE entries SET draft_content = NULL, updated_at = datetime('now') WHERE id = ?`,
    [id],
  );
  const updated = await db.queryOne<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
  return rowToEntry(updated!);
},
```

- [ ] **Step 4: Run the new tests**

Run: `pnpm --filter @vulse/core test -- src/content/__tests__/drafts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/content/
git commit -m "feat(core): publish/unpublish/discardDraft service methods"
```

---

### Task B6: Revisions `kind` column

**Files:**
- Modify: `packages/core/src/revisions/types.ts`
- Modify: `packages/core/src/revisions/service.ts`

- [ ] **Step 1: Extend `RevisionDTO`/`RevisionSummary`**

In `packages/core/src/revisions/types.ts`:

```ts
export type RevisionKind = 'draft' | 'publish';

export interface RevisionSummary {
  id: string;
  entryId: string;
  revisionNumber: number;
  kind: RevisionKind;
  createdAt: string;
  createdBy: string | null;
}

export interface RevisionDTO extends RevisionSummary {
  content: Record<string, unknown>;
}
```

- [ ] **Step 2: Update `snapshotRevision` signature**

```ts
export async function snapshotRevision(
  adapter: DatabaseAdapter,
  entryId: string,
  content: Record<string, unknown>,
  actor: { userId: string } | null = null,
  kind: RevisionKind = 'draft',
): Promise<RevisionDTO> {
  const maxRow = await adapter.queryOne<{ m: number | null }>(
    'SELECT MAX(revision_number) AS m FROM revisions WHERE entry_id = ?', [entryId],
  );
  const next = (maxRow?.m ?? 0) + 1;
  const id = ulid();
  await adapter.exec(
    `INSERT INTO revisions (id, entry_id, revision_number, kind, content, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, entryId, next, kind, JSON.stringify(content), actor?.userId ?? null],
  );
  const row = await adapter.queryOne<RevisionRow>('SELECT * FROM revisions WHERE id = ?', [id]);
  if (!row) throw new Error('failed to write revision');
  return rowToDTO(row);
}
```

Update `RevisionRow` to include `kind: string`, and update `rowToSummary` to surface it.

In `listRevisions`, include `kind` in the SELECT:

```ts
`SELECT id, entry_id, revision_number, kind, '' AS content, created_at, created_by
 FROM revisions WHERE entry_id = ?
 ORDER BY revision_number DESC LIMIT ? OFFSET ?`
```

- [ ] **Step 3: Run revisions tests**

Run: `pnpm --filter @vulse/core test -- src/revisions`
Expected: PASS. Adjust any test asserting the old DTO shape.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/revisions/
git commit -m "feat(core): revisions track kind (draft|publish)"
```

---

## Phase C — HTTP layer

### Task C1: Modify entry POST/PATCH to accept `publish`

**Files:**
- Modify: `packages/core/src/http/api.ts`
- Modify: `packages/core/src/http/__tests__/drafts.api.test.ts` (new — create alongside the existing `api.test.ts`)

- [ ] **Step 1: Create the test file with a failing test**

```ts
// packages/core/src/http/__tests__/drafts.api.test.ts
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { describe, expect, it } from 'vitest';
import { loadBlueprints } from '../../blueprints/load.js';
import { seedBlueprintsFromCode } from '../../blueprints/seed.js';
import { createApi } from '../api.js';
import { createContentService } from '../../content/service.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', 'blueprints', '__fixtures__');

async function setupApi() {
  // Reuse whatever helper the other api tests use to mount the h3 app. See
  // packages/core/src/http/api.test.ts for the exact pattern — it builds the
  // app via createApi() and uses h3's `toWebHandler` (or similar) to fire
  // requests at it. Copy that helper structure here.
}
```

Then add a first failing assertion:

```ts
it('POST /api/collections/:handle accepts publish:false (drafts-enabled)', async () => {
  const { request } = await setupApi();
  const res = await request('POST', '/api/collections/drafts-posts', {
    body: { title: 'A', slug: 'a', publish: false },
    asSuperUser: true,
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.status).toBe('draft');
  expect(body.draftContent).toEqual({ title: 'A', slug: 'a' });
  expect(body.content).toEqual({});
});

it('PATCH /api/collections/:handle/:id with publish:true promotes', async () => {
  const { request } = await setupApi();
  const created = await request('POST', '/api/collections/drafts-posts', {
    body: { title: 'B', slug: 'b' }, asSuperUser: true,
  });
  const { id } = await created.json();
  const res = await request('PATCH', `/api/collections/drafts-posts/${id}`, {
    body: { title: 'B2', publish: true }, asSuperUser: true,
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('published');
  expect(body.content).toMatchObject({ title: 'B2' });
});
```

Note: read `packages/core/src/http/api.test.ts` first and lift the actual setup helper into this new file (or import it if it's already exported). Don't reinvent the request-firing helper.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @vulse/core test -- src/http/__tests__/drafts.api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modify the POST handler in `api.ts`**

In `packages/core/src/http/api.ts`, in the `router.post('/api/collections/:handle', ...)` block:

```ts
const body = (await readBody(event)) as Record<string, unknown> & { publish?: boolean };
const { publish, ...input } = body;
const userId = event.context.user?.id;
const entry = await content.create(
  handle, input,
  userId ? { actor: { userId } } : undefined,
  { publish: publish ?? true },   // default true for backwards-compat; ignored for drafts-disabled.
);
```

Wait — the design says drafts-enabled creates default to `publish=true` only if the *user* didn't choose. The admin's "Save draft" button explicitly sends `publish: false`. The default if the body omits `publish` is `true` (publish on save, equivalent to today's behaviour). The service already treats `undefined` on a drafts-disabled collection as "publish=true (ignored)". So this default is correct.

- [ ] **Step 4: Modify the PATCH handler symmetrically**

```ts
const body = (await readBody(event)) as Record<string, unknown> & { publish?: boolean };
const { publish, ...input } = body;
const userId = event.context.user?.id;
return await content.update(
  handle, id, input,
  userId ? { actor: { userId } } : undefined,
  { publish: publish ?? false },   // default false for PATCH — never silently re-publish.
);
```

The asymmetry matters: a CREATE that omits `publish` is "publish on save" (the existing behaviour). A PATCH that omits `publish` is "save draft" — because once an entry exists, every subsequent edit should require explicit promotion. The admin always sends the flag; this default protects API users.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @vulse/core test -- src/http/__tests__/drafts.api.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/http/
git commit -m "feat(core): entry POST/PATCH accept publish flag"
```

---

### Task C2: HTTP `/publish`, `/unpublish`, `/draft` endpoints

**Files:**
- Modify: `packages/core/src/http/api.ts`
- Modify: `packages/core/src/http/__tests__/drafts.api.test.ts`

- [ ] **Step 1: Write the failing tests**

Append:

```ts
it('POST /:id/publish promotes the draft', async () => {
  const { request } = await setupApi();
  const c = await request('POST', '/api/collections/drafts-posts', {
    body: { title: 'P', slug: 'p', publish: false }, asSuperUser: true,
  });
  const { id } = await c.json();
  const res = await request('POST', `/api/collections/drafts-posts/${id}/publish`, {
    asSuperUser: true,
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('published');
  expect(body.draftContent).toBeNull();
});

it('POST /:id/unpublish demotes to draft', async () => {
  const { request } = await setupApi();
  const c = await request('POST', '/api/collections/drafts-posts', {
    body: { title: 'Q', slug: 'q' }, asSuperUser: true,
  });
  const { id } = await c.json();
  const res = await request('POST', `/api/collections/drafts-posts/${id}/unpublish`, {
    asSuperUser: true,
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('draft');
});

it('DELETE /:id/draft clears the working copy', async () => {
  const { request } = await setupApi();
  const c = await request('POST', '/api/collections/drafts-posts', {
    body: { title: 'R', slug: 'r' }, asSuperUser: true,
  });
  const { id } = await c.json();
  await request('PATCH', `/api/collections/drafts-posts/${id}`, {
    body: { title: 'R-draft' }, asSuperUser: true,  // publish defaults to false on PATCH
  });
  const res = await request('DELETE', `/api/collections/drafts-posts/${id}/draft`, {
    asSuperUser: true,
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.draftContent).toBeNull();
  expect(body.content).toMatchObject({ title: 'R' });
});

it('publish without publish permission returns 403', async () => {
  const { request } = await setupApi();
  const c = await request('POST', '/api/collections/drafts-posts', {
    body: { title: 'S', slug: 's' }, asSuperUser: true,
  });
  const { id } = await c.json();
  // setup helper should support asEditor(perms) where perms omits 'publish'.
  const res = await request('POST', `/api/collections/drafts-posts/${id}/publish`, {
    asEditor: { perms: { 'drafts-posts': ['read', 'update'] } },
  });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @vulse/core test -- src/http/__tests__/drafts.api.test.ts -t 'publish|unpublish|draft'`
Expected: FAIL.

- [ ] **Step 3: Add routes**

In `packages/core/src/http/api.ts`, after the existing `move` handler:

```ts
router.post(
  '/api/collections/:handle/:id/publish',
  withPerm({ action: 'publish', adapter },
    safe(async (event) => {
      const handle = getRouterParam(event, 'handle') as string;
      const id = getRouterParam(event, 'id') as string;
      if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
      const userId = event.context.user?.id;
      return await content.publish(handle, id, userId ? { actor: { userId } } : undefined);
    }),
  ),
);

router.post(
  '/api/collections/:handle/:id/unpublish',
  withPerm({ action: 'publish', adapter },
    safe(async (event) => {
      const handle = getRouterParam(event, 'handle') as string;
      const id = getRouterParam(event, 'id') as string;
      if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
      const userId = event.context.user?.id;
      return await content.unpublish(handle, id, userId ? { actor: { userId } } : undefined);
    }),
  ),
);

router.delete(
  '/api/collections/:handle/:id/draft',
  withPerm({ action: 'update', adapter },
    safe(async (event) => {
      const handle = getRouterParam(event, 'handle') as string;
      const id = getRouterParam(event, 'id') as string;
      if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
      const userId = event.context.user?.id;
      return await content.discardDraft(handle, id, userId ? { actor: { userId } } : undefined);
    }),
  ),
);
```

`withPerm` already handles 401/403. The service-layer `ValidationError`s flow through `safe()` and become 400 responses (matches the existing pattern for other mutation endpoints).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @vulse/core test -- src/http/__tests__/drafts.api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/
git commit -m "feat(core): publish/unpublish/draft HTTP endpoints"
```

---

### Task C3: `includeDrafts` query support for admin GETs

**Files:**
- Modify: `packages/core/src/http/api.ts`
- Modify: `packages/core/src/http/__tests__/drafts.api.test.ts`

The semantics: any GET to `/api/collections/:handle` (the *admin-side* list endpoint mounted with `withPerm({ action: 'read' })`) accepts `?includeDrafts=1`. The *public* override-driven endpoint at `/api/collections/:handle` (note: there are two; check `api.ts`) does NOT pass the flag through.

- [ ] **Step 1: Identify the two endpoints**

Open `packages/core/src/http/api.ts` and grep for both `/api/collections/:handle` GET handlers:
- Admin/auth-protected list (uses `withPerm`).
- Public route-override endpoint (in `packages/core/src/http/public.api.ts` or similar — search for the file that handles unauth requests).

Confirm which is which before editing. The admin one is the only one that should consult `includeDrafts`.

- [ ] **Step 2: Write the failing test**

```ts
it('GET /api/collections/:handle?includeDrafts=1 returns drafts to admin', async () => {
  const { request } = await setupApi();
  await request('POST', '/api/collections/drafts-posts', {
    body: { title: 'D', slug: 'd', publish: false }, asSuperUser: true,
  });
  const r1 = await request('GET', '/api/collections/drafts-posts', { asSuperUser: true });
  expect((await r1.json()).items).toHaveLength(0);
  const r2 = await request('GET', '/api/collections/drafts-posts?includeDrafts=1', {
    asSuperUser: true,
  });
  expect((await r2.json()).items).toHaveLength(1);
});

it('public endpoint never returns drafts even if param is sent', async () => {
  const { request } = await setupApi();
  await request('POST', '/api/collections/drafts-posts', {
    body: { title: 'X', slug: 'x', publish: false }, asSuperUser: true,
  });
  // unauthenticated, public route-override endpoint:
  const res = await request('GET',
    '/api/collections/drafts-posts?includeDrafts=1',
    { asAnonymous: true });
  expect((await res.json()).items).toHaveLength(0);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @vulse/core test -- src/http/__tests__/drafts.api.test.ts -t includeDrafts`
Expected: FAIL.

- [ ] **Step 4: Wire the param through the admin list handler**

In the admin-protected GET (the one wrapped with `withPerm({ action: 'read' })`):

```ts
const query = getQuery(event);
const includeDrafts = query.includeDrafts === '1' || query.includeDrafts === 'true';
return await content.list(handle, {
  // ...existing opts (limit, offset, q, field, filter, sort, parentId)
  includeDrafts,
});
```

The public endpoint stays untouched — the service defaults `includeDrafts: false`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @vulse/core test -- src/http/__tests__/drafts.api.test.ts -t includeDrafts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/http/
git commit -m "feat(core): admin GET supports includeDrafts; public endpoint ignores it"
```

---

### Task C4: Preview token sign/verify module

**Files:**
- Create: `packages/core/src/preview/preview-token.ts`
- Create: `packages/core/src/preview/preview-token.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/preview/preview-token.test.ts
import { describe, expect, it } from 'vitest';
import { signPreviewToken, verifyPreviewToken } from './preview-token.js';

const secret = 'test-secret';

describe('preview-token', () => {
  it('round-trips entryId + userId', () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = signPreviewToken({ entryId: 'e1', userId: 'u1', exp }, secret);
    const result = verifyPreviewToken(token, secret);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.entryId).toBe('e1');
      expect(result.payload.userId).toBe('u1');
    }
  });

  it('rejects expired tokens', () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const token = signPreviewToken({ entryId: 'e1', userId: 'u1', exp }, secret);
    const result = verifyPreviewToken(token, secret);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('rejects tampered payload', () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = signPreviewToken({ entryId: 'e1', userId: 'u1', exp }, secret);
    const tampered = token.replace(/^vp_[^.]+/, 'vp_AAAAAA');
    const result = verifyPreviewToken(tampered, secret);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_signature');
  });

  it('rejects tokens signed with a different secret', () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = signPreviewToken({ entryId: 'e1', userId: 'u1', exp }, secret);
    const result = verifyPreviewToken(token, 'other-secret');
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vulse/core test -- src/preview/preview-token.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/preview/preview-token.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PreviewTokenPayload {
  entryId: string;
  userId: string;
  exp: number; // unix seconds
}

export type PreviewVerifyResult =
  | { ok: true; payload: PreviewTokenPayload }
  | { ok: false; reason: 'malformed' | 'invalid_signature' | 'expired' };

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s: string): Buffer {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signPreviewToken(payload: PreviewTokenPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `vp_${body}.${sig}`;
}

export function verifyPreviewToken(token: string, secret: string): PreviewVerifyResult {
  if (!token.startsWith('vp_')) return { ok: false, reason: 'malformed' };
  const rest = token.slice(3);
  const dot = rest.indexOf('.');
  if (dot < 0) return { ok: false, reason: 'malformed' };
  const body = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);

  const expected = b64url(createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  let payload: PreviewTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload || typeof payload.entryId !== 'string' || typeof payload.userId !== 'string'
      || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}
```

- [ ] **Step 4: Export from package root**

In `packages/core/src/index.ts`, append:

```ts
export {
  signPreviewToken,
  verifyPreviewToken,
  type PreviewTokenPayload,
  type PreviewVerifyResult,
} from './preview/preview-token.js';
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @vulse/core test -- src/preview`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/preview packages/core/src/index.ts
git commit -m "feat(core): HMAC-signed preview tokens"
```

---

### Task C5: Preview-token HTTP endpoint

**Files:**
- Modify: `packages/core/src/http/api.ts`
- Modify: `packages/core/src/http/__tests__/drafts.api.test.ts`

- [ ] **Step 1: Decide where the secret comes from**

Convention: read `VULSE_PREVIEW_SECRET` from `process.env`, falling back to `VULSE_SESSION_SECRET`. If neither is set, fall back to a runtime-generated random string scoped per process (printed to logs as a warning).

Add to `createApi(deps)` deps — the existing function already takes `adapter`, `content`, `blueprints`, etc. Look at the existing `ApiDeps` interface and consider adding `previewSecret?: string` so the app can inject it from server bootstrap. (`apps/dev/src/main.ts` is where it'll be wired.)

- [ ] **Step 2: Write the failing test**

```ts
it('POST /:id/preview-token returns a verifiable token', async () => {
  const { request, previewSecret } = await setupApi();   // helper exposes secret
  const c = await request('POST', '/api/collections/drafts-posts', {
    body: { title: 'P', slug: 'p', publish: false }, asSuperUser: true,
  });
  const { id } = await c.json();
  const res = await request('POST', `/api/collections/drafts-posts/${id}/preview-token`, {
    asSuperUser: true,
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.token).toMatch(/^vp_/);
  const { verifyPreviewToken } = await import('../../preview/preview-token.js');
  const v = verifyPreviewToken(body.token, previewSecret);
  expect(v.ok).toBe(true);
});

it('preview-token requires read permission', async () => {
  const { request } = await setupApi();
  const c = await request('POST', '/api/collections/drafts-posts', {
    body: { title: 'P', slug: 'p' }, asSuperUser: true,
  });
  const { id } = await c.json();
  const res = await request('POST', `/api/collections/drafts-posts/${id}/preview-token`, {
    asEditor: { perms: { 'drafts-posts': [] } },   // no read
  });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @vulse/core test -- src/http/__tests__/drafts.api.test.ts -t preview-token`
Expected: FAIL.

- [ ] **Step 4: Implement the route**

In `api.ts`:

```ts
router.post(
  '/api/collections/:handle/:id/preview-token',
  withPerm({ action: 'read', adapter },
    safe(async (event) => {
      const handle = getRouterParam(event, 'handle') as string;
      const id = getRouterParam(event, 'id') as string;
      if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
      const user = event.context.user;
      if (!user) return deny(event, 401, { error: 'auth_required' });
      const entry = await content.get(handle, id);
      if (!entry) throw new NotFoundError('entry not found');
      const exp = Math.floor(Date.now() / 1000) + 15 * 60;
      const token = signPreviewToken(
        { entryId: id, userId: user.id, exp },
        deps.previewSecret,
      );
      return { token, expiresAt: new Date(exp * 1000).toISOString() };
    }),
  ),
);
```

Add an import for `signPreviewToken` at the top of `api.ts`.

Extend `ApiDeps`:

```ts
export interface ApiDeps {
  // ...existing
  previewSecret: string;
}
```

Update the dev server (`apps/dev/src/main.ts`) where `createApi` is called to source the secret:

```ts
const previewSecret =
  process.env.VULSE_PREVIEW_SECRET ??
  process.env.VULSE_SESSION_SECRET ??
  (() => { const s = randomBytes(32).toString('hex');
           console.warn('[vulse] generated ephemeral VULSE_PREVIEW_SECRET (set one to survive restarts)');
           return s; })();
createApi({ adapter, content, blueprints, /* etc */ previewSecret });
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @vulse/core test -- src/http/__tests__/drafts.api.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/ apps/dev/
git commit -m "feat(core): POST /:id/preview-token issues 15-minute HMAC tokens"
```

---

## Phase D — Site middleware

### Task D1: Enforce published-only on the site

**Files:**
- Modify: `packages/site/src/server/middleware/render.ts`
- Modify: `packages/site/src/composables/useEntry.ts`
- Modify: `packages/site/src/server/middleware/render.test.ts`

- [ ] **Step 1: Write the failing test**

In `render.test.ts`, add a test:

```ts
it('draft-status entries 404 on the public site', async () => {
  const draftPost: Entry = {
    id: 'd1', collection: 'posts', parentId: null, sortOrder: 1,
    status: 'draft',  // ← key bit
    protected: false,
    content: {}, draftContent: { title: 'D', slug: 'd', body: [] },
    hasUnpublishedChanges: true, publishedAt: null, publishedBy: null,
    createdAt: '', updatedAt: '',
  };
  const deps = {
    blueprints,
    content: {
      list: async () => ({ items: [], total: 0, limit: 25, offset: 0 }),
      get: async () => draftPost,
    },
  } as unknown as SiteServerDeps;
  const { status } = await resolveSiteRequest(deps, new URL('http://x/posts/d'));
  expect(status).toBe(404);
});
```

Note: this test asserts that the *site middleware* checks `status` on the resolved entry. Even if a mock `content.get` returns a draft, the middleware refuses.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vulse/site test -- src/server/middleware/render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update useEntry helpers to filter status**

```ts
// packages/site/src/composables/useEntry.ts
export async function findPublicEntryBySlug(
  content: Pick<ContentService, 'list'>,
  collection: string, slug: string,
  options: { includeProtected?: boolean } = {},
): Promise<Entry | null> {
  const result = await content.list(collection, {
    field: 'slug', q: slug, limit: 100,
    includeProtected: options.includeProtected ?? false,
    // includeDrafts intentionally omitted (defaults false in the service).
  });
  const entry = result.items.find((e) => String(e.content.slug ?? '') === slug);
  if (!entry || entry.status !== 'published') return null;
  return entry;
}

export async function getPublicEntryById(
  content: Pick<ContentService, 'get'>,
  collection: string, id: string,
  options: { includeProtected?: boolean } = {},
): Promise<Entry | null> {
  const entry = await content.get(collection, id);
  if (!entry) return null;
  if (entry.status !== 'published') return null;
  if (entry.protected && !options.includeProtected) return null;
  return entry;
}
```

- [ ] **Step 4: Belt-and-braces in `resolveOverride` and the home-page branch of `resolveSiteRequest`**

Wherever the middleware calls `content.list(...)` directly (not via `findPublicEntryBySlug`), the service's default `includeDrafts: false` already excludes drafts. But the override branch (`override.list`) shouldn't be allowed to override that — verify the call site at `packages/site/src/server/middleware/render.ts:81-86` does not allow caller-controlled `includeDrafts`. It does not (the override interface only allows `filter`/`sort`); good.

For the home-page branch, no change needed for the same reason — drafts are filtered at the service layer.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @vulse/site test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/site/
git commit -m "feat(site): public middleware filters non-published entries"
```

---

### Task D2: Site preview-token consumer

**Files:**
- Modify: `packages/site/src/server/middleware/render.ts`
- Modify: `packages/site/src/types.ts` (if needed for new dep)
- Modify: `packages/site/src/server/middleware/render.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('valid preview token swaps draft_content in for the targeted entry', async () => {
  // Build a token with the same secret the deps will use.
  const { signPreviewToken } = await import('@vulse/core');
  const secret = 'test-secret';
  const exp = Math.floor(Date.now() / 1000) + 60;
  const token = signPreviewToken({ entryId: 'd1', userId: 'u1', exp }, secret);

  const draftPost: Entry = {
    id: 'd1', collection: 'posts', parentId: null, sortOrder: 1,
    status: 'published',
    protected: false,
    content: { title: 'live', slug: 'd', body: [] },
    draftContent: { title: 'draft-version', slug: 'd', body: [] },
    hasUnpublishedChanges: true,
    publishedAt: '2026-01-01T00:00:00Z', publishedBy: 'u1',
    createdAt: '', updatedAt: '',
  };
  const deps = {
    blueprints,
    previewSecret: secret,
    content: {
      list: async () => ({ items: [draftPost], total: 1, limit: 25, offset: 0 }),
      get: async () => draftPost,
    },
  } as unknown as SiteServerDeps;

  const { state } = await resolveSiteRequest(deps,
    new URL(`http://x/posts/d?vulse-preview=${token}`));
  expect(state.entry?.content).toEqual({ title: 'draft-version', slug: 'd', body: [] });
});

it('expired preview token falls back to published rendering', async () => {
  const { signPreviewToken } = await import('@vulse/core');
  const secret = 'test-secret';
  const exp = Math.floor(Date.now() / 1000) - 60;
  const token = signPreviewToken({ entryId: 'd1', userId: 'u1', exp }, secret);
  // ...build same deps as above
  // expect state.entry?.content to be the live { title: 'live', ... }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @vulse/site test -- src/server/middleware/render.test.ts -t preview`
Expected: FAIL.

- [ ] **Step 3: Add `previewSecret` to `SiteServerDeps`**

```ts
// packages/site/src/types.ts (add to SiteServerDeps interface)
previewSecret?: string;
```

- [ ] **Step 4: Implement preview-token consumer**

In `render.ts`, add a helper:

```ts
import { verifyPreviewToken } from '@vulse/core';

function readPreviewToken(deps: SiteServerDeps, url: URL):
  { entryId: string } | null {
  const token = url.searchParams.get('vulse-preview');
  if (!token || !deps.previewSecret) return null;
  const result = verifyPreviewToken(token, deps.previewSecret);
  if (!result.ok) return null;
  return { entryId: result.payload.entryId };
}

function applyPreview(entry: Entry | null, preview: { entryId: string } | null): Entry | null {
  if (!entry || !preview || entry.id !== preview.entryId || !entry.draftContent) return entry;
  return { ...entry, content: entry.draftContent };
}
```

Modify each detail-path branch in `resolveSiteRequest` to read the preview token and apply it:

```ts
const previewMatch = readPreviewToken(deps, url);
// ...for each branch that resolves a single entry:
const entry = applyPreview(/* whatever was resolved */, previewMatch);
```

Critically, for the preview to work on `status='draft'` entries that the new published-only filter rejects, also bypass the filter when the token matches:

```ts
// In findPublicEntryBySlug / getPublicEntryById call sites in render.ts:
let entry = await getPublicEntryById(deps.content, collection, id, { includeProtected: preview });
if (!entry && previewMatch?.entryId === id) {
  // The published filter dropped it. Re-fetch raw (bypassing status filter).
  const raw = await deps.content.get(collection, id);
  if (raw && raw.draftContent) entry = { ...raw, content: raw.draftContent };
}
```

Set response headers in `createSiteRenderer`:

```ts
if (url.searchParams.has('vulse-preview')) {
  setResponseHeader(event, 'x-robots-tag', 'noindex, nofollow');
  setResponseHeader(event, 'cache-control', 'no-store');
}
```

- [ ] **Step 5: Wire `previewSecret` into dev server**

In `apps/dev/src/main.ts` where `createSiteServer` deps are assembled, pass `previewSecret` from the same env logic as the API.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @vulse/site test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/site/ apps/dev/
git commit -m "feat(site): preview-token consumer swaps draft for live on target entry"
```

---

## Phase E — Admin UI

### Task E1: Admin API client — types + methods

**Files:**
- Modify: `packages/admin/src/api/client.ts`

- [ ] **Step 1: Extend the `Entry` type**

```ts
export interface Entry {
  id: string;
  collection: string;
  parentId: string | null;
  sortOrder: number;
  status: string;
  content: Record<string, unknown>;
  draftContent: Record<string, unknown> | null;
  hasUnpublishedChanges: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
  updatedAt: string;
  protected: boolean;
}
```

- [ ] **Step 2: Extend `EntryListQuery`**

```ts
export interface EntryListQuery {
  limit?: number;
  offset?: number;
  q?: string;
  field?: string;
  parentId?: string | null;
  includeDrafts?: boolean;
}
```

In whatever helper builds the querystring for `list`, append `&includeDrafts=1` when `query.includeDrafts === true`.

- [ ] **Step 3: Change `create`/`update` to accept publish flag**

```ts
create(handle: string, input: Record<string, unknown>, opts?: { publish?: boolean }): Promise<Entry> {
  const body = opts?.publish !== undefined ? { ...input, publish: opts.publish } : input;
  return this.post(`/api/collections/${handle}`, body);
},
update(handle: string, id: string, input: Record<string, unknown>, opts?: { publish?: boolean }): Promise<Entry> {
  const body = opts?.publish !== undefined ? { ...input, publish: opts.publish } : input;
  return this.patch(`/api/collections/${handle}/${id}`, body);
},
```

- [ ] **Step 4: Add publish/unpublish/discardDraft/preview-token methods**

```ts
publish(handle: string, id: string): Promise<Entry> {
  return this.post(`/api/collections/${handle}/${id}/publish`, {});
},
unpublish(handle: string, id: string): Promise<Entry> {
  return this.post(`/api/collections/${handle}/${id}/unpublish`, {});
},
discardDraft(handle: string, id: string): Promise<Entry> {
  return this.delete(`/api/collections/${handle}/${id}/draft`);
},
previewToken(handle: string, id: string): Promise<{ token: string; expiresAt: string }> {
  return this.post(`/api/collections/${handle}/${id}/preview-token`, {});
},
```

If `this.delete` doesn't exist on the client class, add it next to the existing `post`/`patch` helpers.

- [ ] **Step 5: Extend `MeResponse.perms` action union**

```ts
export interface MeResponse {
  user: AuthUser | null;
  perms: Record<string, ('read' | 'create' | 'update' | 'delete' | 'publish')[]>;
}
```

- [ ] **Step 6: Extend `GroupDTO` permission rows**

```ts
permissions: {
  collectionHandle: string;
  canRead: boolean; canCreate: boolean; canUpdate: boolean;
  canDelete: boolean; canPublish: boolean;
}[];
```

- [ ] **Step 7: Extend `BlueprintMeta`**

```ts
export interface BlueprintMeta {
  // ...existing fields
  drafts?: boolean;
}
```

- [ ] **Step 8: Type-check**

Run: `pnpm --filter @vulse/admin check`
Expected: PASS (no consumer should be relying on old shapes since we only added optional fields).

- [ ] **Step 9: Commit**

```bash
git add packages/admin/src/api/client.ts
git commit -m "feat(admin): API client adds publish/unpublish/discardDraft/previewToken"
```

---

### Task E2: Status badge component

**Files:**
- Create: `packages/admin/src/components/EntryStatusBadge.vue`

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  status: string;
  hasUnpublishedChanges: boolean;
}>();

const label = computed(() => {
  if (props.status !== 'published') return 'Draft';
  if (props.hasUnpublishedChanges) return 'Published · unpublished changes';
  return 'Published';
});

const tone = computed(() => {
  if (props.status !== 'published') return 'draft';
  if (props.hasUnpublishedChanges) return 'mixed';
  return 'published';
});
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
    :class="{
      'bg-amber-50 text-amber-800 ring-1 ring-amber-200': tone === 'draft',
      'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200': tone === 'published',
      'bg-emerald-50 text-emerald-800 ring-1 ring-amber-300': tone === 'mixed',
    }"
    :data-testid="`status-badge-${tone}`"
  >
    <span
      class="h-1.5 w-1.5 rounded-full"
      :class="{
        'bg-amber-500': tone === 'draft' || tone === 'mixed',
        'bg-emerald-500': tone === 'published',
      }"
    />
    {{ label }}
  </span>
</template>
```

- [ ] **Step 2: Manual sanity check**

Drop into the admin via `pnpm dev`, navigate to any entry editor, and import-and-render the badge temporarily next to the title to eyeball the colours. Revert after.

- [ ] **Step 3: Commit**

```bash
git add packages/admin/src/components/EntryStatusBadge.vue
git commit -m "feat(admin): EntryStatusBadge component"
```

---

### Task E3: Split Save button + actions on CollectionEntry

**Files:**
- Modify: `packages/admin/src/pages/CollectionEntry.vue`

- [ ] **Step 1: Read the current `save()` and form layout**

Reference: `packages/admin/src/pages/CollectionEntry.vue:215-258` (save function) and `333-349` (button block).

- [ ] **Step 2: Add state + computed for drafts**

In the `<script setup>` block:

```ts
import EntryStatusBadge from '../components/EntryStatusBadge.vue';

const draftsEnabled = computed(() => blueprint.value?.drafts === true);
const canPublish = computed(() =>
  auth.user?.isSuper || auth.perms?.[props.handle]?.includes('publish') === true
);
const currentEntry = ref<Entry | null>(null);   // populated in loadEntry alongside state hydration
const LAST_SAVE_KEY = 'vulse.editor.lastSaveAction';
const lastSaveAction = ref<'draft' | 'publish'>(
  (typeof localStorage !== 'undefined' && localStorage.getItem(LAST_SAVE_KEY) === 'publish')
    ? 'publish' : 'draft'
);
function rememberAction(v: 'draft' | 'publish') {
  lastSaveAction.value = v;
  try { localStorage.setItem(LAST_SAVE_KEY, v); } catch { /* SSR */ }
}
```

In `loadEntry()`, after fetching the entry, set `currentEntry.value = entry` and seed `state` from `entry.draftContent ?? entry.content`.

- [ ] **Step 3: Replace `save()` with `save(action)`**

```ts
async function save(action: 'draft' | 'publish') {
  for (const k of Object.keys(errors)) delete errors[k];
  submitError.value = null;
  saving.value = true;
  const publish = draftsEnabled.value ? action === 'publish' : true;
  rememberAction(action);
  try {
    let entry: Entry;
    if (props.id) {
      entry = await api.update(props.handle, props.id, {
        ...state, protected: isProtected.value,
      }, { publish });
      if (isTreeCollection.value && parentId.value !== originalParentId.value) {
        entry = await api.moveEntry(props.handle, props.id, { parentId: parentId.value });
        originalParentId.value = parentId.value;
      }
    } else {
      const payload: Record<string, unknown> = { ...state, protected: isProtected.value };
      if (isTreeCollection.value && parentId.value !== null) payload.parentId = parentId.value;
      entry = await api.create(props.handle, payload, { publish });
    }
    currentEntry.value = entry;
    toasts.success(publish ? 'Entry published' : 'Draft saved');
    if (!props.id) router.replace(`/collections/${props.handle}/${entry.id}`);
  } catch (err) {
    // ...existing error handling unchanged
  } finally {
    saving.value = false;
  }
}

async function publishNow() {
  if (!props.id) return;
  saving.value = true;
  try {
    currentEntry.value = await api.publish(props.handle, props.id);
    toasts.success('Published');
  } catch (e) { /* same shape as save() catch */ } finally { saving.value = false; }
}
async function unpublishNow() {
  if (!props.id) return;
  if (!window.confirm('Unpublish this entry? It will be removed from the public site.')) return;
  saving.value = true;
  try {
    currentEntry.value = await api.unpublish(props.handle, props.id);
    toasts.success('Unpublished');
  } catch (e) { /* ... */ } finally { saving.value = false; }
}
async function discardDraft() {
  if (!props.id) return;
  if (!window.confirm('Discard unpublished changes? This cannot be undone.')) return;
  saving.value = true;
  try {
    const entry = await api.discardDraft(props.handle, props.id);
    currentEntry.value = entry;
    Object.assign(state, entry.content);
    toasts.success('Draft discarded');
  } catch (e) { /* ... */ } finally { saving.value = false; }
}
```

- [ ] **Step 4: Replace the Save button block in the template**

```vue
<!-- Replace the existing <button type="submit"> block -->
<div class="flex items-center gap-2">
  <template v-if="draftsEnabled">
    <div class="inline-flex rounded shadow-sm" data-testid="save-split">
      <button
        type="button"
        class="vulse-button-primary rounded-l px-4 py-2 text-sm font-medium disabled:opacity-50"
        :disabled="saving || (lastSaveAction === 'publish' && !canPublish)"
        :data-testid="`submit-${lastSaveAction}`"
        @click="save(lastSaveAction)"
      >
        {{ saving ? 'Saving…'
           : lastSaveAction === 'publish' ? 'Save & publish' : 'Save draft' }}
      </button>
      <details class="relative" @click.stop>
        <summary class="vulse-button-primary cursor-pointer rounded-r border-l border-zinc-700 px-2 py-2 text-sm">▾</summary>
        <div class="absolute right-0 z-10 mt-1 w-48 rounded border border-zinc-200 bg-white py-1 text-sm shadow">
          <button type="button"
            class="block w-full px-3 py-1.5 text-left hover:bg-zinc-50"
            data-testid="save-as-draft"
            @click="save('draft')">Save draft</button>
          <button type="button"
            class="block w-full px-3 py-1.5 text-left hover:bg-zinc-50 disabled:opacity-50"
            :disabled="!canPublish"
            data-testid="save-and-publish"
            @click="save('publish')">Save & publish</button>
          <button v-if="currentEntry?.hasUnpublishedChanges"
            type="button"
            class="block w-full px-3 py-1.5 text-left text-amber-700 hover:bg-amber-50"
            data-testid="discard-draft"
            @click="discardDraft">Discard draft</button>
          <button v-if="currentEntry?.status === 'published' && canPublish"
            type="button"
            class="block w-full px-3 py-1.5 text-left text-zinc-600 hover:bg-zinc-50"
            data-testid="unpublish"
            @click="unpublishNow">Unpublish</button>
        </div>
      </details>
    </div>
  </template>
  <button v-else type="submit"
    class="vulse-button-primary rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
    :disabled="saving"
    data-testid="submit"
    @click.prevent="save('publish')">
    {{ saving ? 'Saving…' : 'Save' }}
  </button>

  <RouterLink :to="`/collections/${handle}`"
    class="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
    data-testid="cancel">Cancel</RouterLink>
</div>
```

- [ ] **Step 5: Render the status badge next to the title**

Modify the `<h1>` line:

```vue
<div class="mb-4 flex items-center gap-3">
  <h1 class="text-xl font-semibold">{{ id ? 'Edit' : 'New' }} {{ blueprint.label }}</h1>
  <EntryStatusBadge v-if="id && currentEntry && draftsEnabled"
    :status="currentEntry.status"
    :has-unpublished-changes="currentEntry.hasUnpublishedChanges" />
</div>
```

- [ ] **Step 6: Manual test in the dev app**

Reset the dev DB (`rm apps/dev/dev.db`), restart `pnpm dev`, and:

1. Create a `drafts-posts` collection blueprint (or seed it from the fixture once Task E5 lands; for now, create one manually in the admin) and confirm:
2. Save draft → entry list shows draft, public site 404s.
3. Save & publish → public site renders.
4. Save draft on top of published → public site still shows old content.
5. Discard draft → form repopulates with the published content.

- [ ] **Step 7: Commit**

```bash
git add packages/admin/src/pages/CollectionEntry.vue
git commit -m "feat(admin): split Save button + draft actions in entry editor"
```

---

### Task E4: Preview button

**Files:**
- Modify: `packages/admin/src/pages/CollectionEntry.vue`

- [ ] **Step 1: Add a helper to resolve a public URL for an entry**

Decision: rather than re-implementing route resolution in the admin, hit the entry's `slug` field (if present) and prepend the collection handle. This matches the default site-route convention; collections with custom route overrides will need a small follow-up (out of scope for v1 — note in the spec's "open" section).

```ts
function previewUrl(entry: Entry): string {
  const slug = entry.draftContent?.slug ?? entry.content?.slug;
  if (typeof slug !== 'string' || slug.length === 0) {
    return `/${props.handle}/${entry.id}`;  // fallback
  }
  return `/${props.handle}/${slug}`;
}

async function openPreview() {
  if (!props.id || !currentEntry.value) return;
  const { token } = await api.previewToken(props.handle, props.id);
  const url = previewUrl(currentEntry.value);
  window.open(`${url}?vulse-preview=${encodeURIComponent(token)}`, '_blank');
}
```

- [ ] **Step 2: Render the button**

Inside the `<div class="flex items-center gap-2">` action row (next to Save), or beside the title:

```vue
<button v-if="id && draftsEnabled && currentEntry
  && (currentEntry.hasUnpublishedChanges || currentEntry.status !== 'published')"
  type="button"
  class="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
  data-testid="preview-button"
  @click="openPreview">
  Preview
</button>
```

- [ ] **Step 3: Manual sanity check**

In the dev app: save a draft → click Preview → new tab opens with the draft content + `vulse-preview=...` in the URL.

- [ ] **Step 4: Commit**

```bash
git add packages/admin/src/pages/CollectionEntry.vue
git commit -m "feat(admin): Preview button opens public URL with signed token"
```

---

### Task E5: Entry list — status column + filter chip

**Files:**
- Modify: `packages/admin/src/pages/CollectionList.vue`

- [ ] **Step 1: Add filter chip state**

```ts
import EntryStatusBadge from '../components/EntryStatusBadge.vue';

const draftsEnabled = computed(() => blueprint.value?.drafts === true);
const statusFilter = ref<'all' | 'drafts' | 'published'>('all');
```

- [ ] **Step 2: Add the chip UI above the table**

```vue
<div v-if="draftsEnabled" class="mb-3 flex gap-1" data-testid="status-filter">
  <button v-for="opt in (['all','drafts','published'] as const)" :key="opt"
    type="button"
    class="rounded-full border px-3 py-1 text-xs"
    :class="statusFilter === opt
      ? 'border-zinc-900 bg-zinc-900 text-white'
      : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'"
    :data-testid="`status-filter-${opt}`"
    @click="statusFilter = opt">
    {{ { all: 'All', drafts: 'Drafts only', published: 'Published only' }[opt] }}
  </button>
</div>
```

- [ ] **Step 3: Pipe `statusFilter` into the list call**

Wherever `api.listEntries(...)` is invoked, switch on `statusFilter`:

```ts
const query: EntryListQuery = {
  limit, offset,
  includeDrafts: statusFilter.value !== 'published',
  ...(statusFilter.value === 'drafts'
    ? { filter: { status: { eq: 'draft' } } as Record<string, FieldFilter> } : {}),
  ...(statusFilter.value === 'published'
    ? { filter: { status: { eq: 'published' } } as Record<string, FieldFilter> } : {}),
};
```

If `listEntries` doesn't currently accept `filter`, extend its signature symmetrically and pass through. The HTTP filter parser already supports `?filter[status][eq]=draft` per `parseListQuery`.

- [ ] **Step 4: Add status column to the table**

Add a `<th>Status</th>` header and a `<td>` per row:

```vue
<td class="px-3 py-2">
  <EntryStatusBadge v-if="draftsEnabled"
    :status="row.status"
    :has-unpublished-changes="row.hasUnpublishedChanges" />
  <span v-else class="text-xs text-zinc-400">—</span>
</td>
```

- [ ] **Step 5: Manual test**

Verify drafts appear only when filter allows them, and the chip toggles correctly.

- [ ] **Step 6: Commit**

```bash
git add packages/admin/src/pages/CollectionList.vue
git commit -m "feat(admin): entry list shows status column + filter chip"
```

---

### Task E6: Schema editor — drafts checkbox

**Files:**
- Modify: `packages/admin/src/pages/BlueprintEditor.vue`

- [ ] **Step 1: Add the checkbox**

Find where the existing `singleton` / `tree` checkboxes live in the template. Add alongside:

```vue
<label class="flex items-center gap-2 text-sm">
  <input v-model="def.drafts" type="checkbox" data-testid="blueprint-drafts" />
  <span class="text-zinc-700">Enable drafts (Save changes without affecting the live site)</span>
</label>
```

- [ ] **Step 2: Bind drafts in the form's state object**

In `<script setup>`, when the editor loads a blueprint, default `def.drafts = bp.drafts ?? false`. When saving, include `drafts` in the PATCH/PUT payload (the API already accepts it from Task A2).

- [ ] **Step 3: Confirm-on-disable guard**

```ts
async function save() {
  // ...existing validation
  if (!def.drafts && original.drafts) {
    // Was on, now off. Check for pending drafts.
    const counts = await api.listEntries(def.handle, {
      filter: { status: { eq: 'draft' } } as Record<string, FieldFilter>,
      limit: 1, includeDrafts: true,
    });
    const draftCount = counts.total;
    const pendingChanges = (await api.listEntries(def.handle, {
      filter: { hasUnpublishedChanges: { eq: true } } as Record<string, FieldFilter>,
      limit: 1, includeDrafts: true,
    })).total; // NOTE: this filter doesn't exist server-side. Use a simpler check:
  }
}
```

**Simpler alternative** (preferred — keeps server contracts clean): just count rows where `status='draft'` *or* `draft_content IS NOT NULL`. We don't expose the latter via the filter API, so fetch the first 200 entries with `includeDrafts: true` and count locally:

```ts
if (!def.drafts && original.drafts) {
  const sample = await api.listEntries(def.handle, { includeDrafts: true, limit: 200 });
  const affected = sample.items.filter(
    (e) => e.status === 'draft' || e.hasUnpublishedChanges,
  ).length;
  if (affected > 0 && !window.confirm(
        `${affected} entries have unpublished changes. Disabling drafts will discard them. Continue?`)) {
    return;
  }
}
```

(Server-side: when `drafts` flips to `false`, the migration is purely declarative — the existing rows still have `draft_content` until the next mutation overwrites them. That's acceptable for v1; the column simply gets ignored. If you want the discard to be enforced server-side, that's a follow-up.)

- [ ] **Step 4: Commit**

```bash
git add packages/admin/src/pages/BlueprintEditor.vue
git commit -m "feat(admin): blueprint editor — Enable drafts checkbox + confirm on disable"
```

---

### Task E7: Group editor — publish checkbox

**Files:**
- Modify: `packages/admin/src/pages/GroupEditor.vue`

- [ ] **Step 1: Add the column**

Find the table of permission checkboxes (Read / Create / Update / Delete). Add `Publish`:

```vue
<th class="px-2 py-1 text-left text-xs uppercase tracking-wide text-zinc-500">Publish</th>
<!-- ... -->
<td class="px-2 py-1">
  <input v-model="row.canPublish" type="checkbox"
    :data-testid="`perm-publish-${row.collectionHandle}`" />
</td>
```

- [ ] **Step 2: Default `canPublish` on new rows**

Wherever the form creates a fresh permission row (e.g. when adding a collection), default `canPublish: false`.

- [ ] **Step 3: Send `canPublish` on save**

The save path almost certainly serializes the rows array as-is to the API. Verify the row object now includes `canPublish` and is accepted by the auth route (already extended in Task A5).

- [ ] **Step 4: Manual test**

Create a group with publish=true on a drafts collection. Sign in as that group, attempt to publish — should succeed. Remove the publish bit, attempt — should 403.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/pages/GroupEditor.vue
git commit -m "feat(admin): group editor — Publish permission checkbox"
```

---

## Phase F — Docs

### Task F1: Schema doc updates

**Files:**
- Modify: `docs/database.md`

- [ ] **Step 1: Add columns to the schema reference**

Append or insert into the existing schema section a description of the new columns:

```markdown
### `entries`

| Column            | Type    | Notes                                                                          |
| ----------------- | ------- | ------------------------------------------------------------------------------ |
| `draft_content`   | TEXT    | Unpublished working copy (JSON). NULL when no pending changes.                 |
| `published_at`    | TEXT    | UTC timestamp of the most recent publish; NULL while status='draft'.           |
| `published_by`    | TEXT    | User id that last published, NULL if never published.                          |

`status` values: `published` (live; `content` is current), `draft` (never published; `content` is empty, working copy in `draft_content`).

### `group_permissions`

Adds `can_publish INTEGER NOT NULL DEFAULT 0` — surfaces as the `publish` action in `effectivePerms`.

### `revisions`

Adds `kind TEXT NOT NULL DEFAULT 'draft'` — `'draft'` for save-draft snapshots, `'publish'` for publish events.
```

- [ ] **Step 2: Commit**

```bash
git add docs/database.md
git commit -m "docs(database): document draft columns and publish permission"
```

---

### Task F2: User-facing drafts doc

**Files:**
- Create: `docs/drafts.md`

- [ ] **Step 1: Write the doc**

```markdown
# Drafts and Publishing

Some Vulse collections support a Statamic-style draft workflow: editors can
save changes that stay invisible to the public site until explicitly
published, and previewing a draft uses the actual public URL (with a
short-lived signed token).

## Opting a collection in

In **Settings → Schema → <Collection>**, tick **Enable drafts**. Existing
entries are unaffected — they stay published with no working copy until
someone saves a draft on top.

Without the flag, saving works exactly as it does today — every save
updates the live site immediately.

## Save actions

For drafts-enabled collections the editor's primary button is a split
button:

- **Save draft** — writes the working copy. The public site keeps showing
  the previous published version (or 404s for never-published entries).
- **Save & publish** — writes the working copy and promotes it to live.

The dropdown also exposes:

- **Discard draft** — throws away the unpublished changes; the live version
  is untouched.
- **Unpublish** — moves the live copy back to a draft. The entry leaves the
  public site until republished.

The button remembers the action you used last in this browser, so repeated
saves don't need extra clicks.

## Previewing

Click **Preview** in the editor toolbar to open the entry on the public
site in a new tab. The URL is decorated with a 15-minute signed token that
swaps in the draft for the target entry only — live visitors still see
the published version. Preview pages set `X-Robots-Tag: noindex, nofollow`
and `Cache-Control: no-store`.

## Permissions

The Groups settings page now has a **Publish** checkbox alongside Read /
Create / Update / Delete. An editor with `update` but no `publish` can only
Save draft — the Save & publish action is disabled.

## Behaviour reference

| Situation                                         | What happens                              |
| ------------------------------------------------- | ----------------------------------------- |
| New entry, **Save draft**                         | Created with status=draft; public 404.    |
| New entry, **Save & publish**                     | Created live (status=published).          |
| Published entry, **Save draft**                   | Working copy written; live unchanged.     |
| Published entry, **Save & publish**               | Live copy replaced.                       |
| Draft entry, **Save & publish**                   | Promoted to status=published.             |
| Published entry with working copy, **Publish**    | Working copy promoted; draft cleared.     |
| Published entry, **Unpublish**                    | Live copy demoted to draft; public 404.   |
| Published entry, **Discard draft**                | Working copy cleared.                     |
| Draft entry, **Discard draft**                    | Refused — delete the entry instead.       |
| Drafts-disabled collection, any save              | Writes live, exactly as today.            |

## Environment

Preview tokens are signed with `VULSE_PREVIEW_SECRET`. If unset, Vulse
falls back to `VULSE_SESSION_SECRET`; if neither is set in production, a
warning is logged and an ephemeral per-process secret is generated.

## Out of scope (for now)

- Scheduled publishing.
- Re-publishing an arbitrary past revision.
- Locking / multi-author conflict resolution on a shared draft.
```

- [ ] **Step 2: Commit**

```bash
git add docs/drafts.md
git commit -m "docs: drafts and publishing user guide"
```

---

### Task F3: Auth doc update

**Files:**
- Modify: `docs/auth.md`

- [ ] **Step 1: Add publish to actions list**

Find the section listing per-collection actions (Read, Create, Update, Delete). Add `Publish` with a one-line description: *"Promote a draft to live, demote a live entry to draft. Required for the publish/unpublish endpoints and the Save & publish button in the editor."*

- [ ] **Step 2: Commit**

```bash
git add docs/auth.md
git commit -m "docs(auth): add publish action"
```

---

## Phase G — Final verification

### Task G1: Full test suite

- [ ] **Step 1: Run every package's tests**

```bash
pnpm --filter @vulse/db test
pnpm --filter @vulse/core test
pnpm --filter @vulse/auth test
pnpm --filter @vulse/site test
pnpm --filter @vulse/admin test
pnpm --filter @vulse/dev test   # smoke test
```

Each should pass. Address any unexpected failures before declaring done.

- [ ] **Step 2: Type-check every package**

```bash
pnpm --filter @vulse/admin check
pnpm --filter @vulse/core check 2>&1 || true   # if check script exists; else tsc
pnpm --filter @vulse/site check 2>&1 || true
pnpm --filter @vulse/dev check
```

- [ ] **Step 3: End-to-end manual smoke**

Reset the dev DB, run `pnpm dev`, then in the browser:

1. Create a new collection `news` with drafts enabled.
2. Create an entry and save as draft.
3. Visit `/news/<slug>` — should 404.
4. Click Preview — opens in a new tab and shows the entry.
5. Save & publish.
6. Visit `/news/<slug>` — should render.
7. Save another draft on top.
8. `/news/<slug>` still shows the previous published version.
9. Click Publish in the dropdown — now `/news/<slug>` shows the new version.
10. Click Unpublish — `/news/<slug>` 404s.
11. Sign in as a non-super user without publish perm — verify Save & publish is disabled.

- [ ] **Step 4: Commit no-code if everything passes**

If any verification turned up cleanup work, commit those fixes with focused messages. If nothing changed, this task simply gates the merge.

---

## Self-review notes

**Spec coverage** — every section of `docs/superpowers/specs/2026-05-19-drafts-publish-design.md` maps to tasks above:
- Data model → A1
- Blueprint flag → A2 + A3
- Permissions → A4 + A5
- Service API (mutation matrix) → B1–B6
- HTTP API (modified + new) → C1–C5
- Site middleware (published filter + preview) → D1 + D2
- Admin UI (split save, badge, preview, list, schema, groups) → E1–E7
- Tests → throughout (each task is TDD)
- Developer docs → F1–F3
- Migration safety → A1 (additive ALTERs only)

**Type/method consistency** — `MutationOptions.publish` is `boolean | undefined` everywhere; `Entry.hasUnpublishedChanges` is derived; service method names match exactly between `ContentService` interface (B1) and `service.ts` implementation (B5). HTTP endpoints match the spec's section "HTTP API" verbatim. Error codes (`drafts_not_enabled`, `entry_already_draft`, `no_draft_to_discard`, `cannot_discard_initial_draft`) are spelled identically in service (B5) and test assertions.

**Notes for the implementer:**
- The Phase B tasks have a soft circular dependency (B3/B4 use `snapshotRevision` with a `kind` arg added in B6). Either land B6 first or pass `'draft'` literal as a string until B6 lands — both work.
- Avoid combining commits across phases; each task ends with a single commit so review/rollback is easy.
- If `pnpm --filter @vulse/admin check` fails on `Entry.draftContent` after Task E1 because some existing component reads `entry.content` directly assuming it's always populated, the fix is to keep reading `entry.content` for the live shape — the new `draftContent` is purely additive.
