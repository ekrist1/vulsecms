# Blueprint Editor — Design

**Date:** 2026-05-15
**Status:** Approved (brainstorming phase)
**Scope:** Move blueprint definitions from TypeScript files into the database and expose a Statamic-style visual editor in the admin UI.

## 1. Goal

A developer or content modeller should be able to:

1. Edit Posts and Authors (and any future blueprint) from the admin UI — add/remove/reorder fields, rename a field, change its kind, edit labels, select options, relationship targets, and required/optional / default / min / max.
2. Have those changes take effect immediately for the content editor without restarting `pnpm dev`.
3. Start a fresh clone with the existing TypeScript blueprint files seeding the database on first boot, then never look at those files again.

This formally supersedes the v1 architecture rule "Blueprint definitions are TypeScript files — no YAML, no JSON, no file-based magic" from `2026-05-14-vulse-cms-v1-vertical-slice-design.md` §5.1. The reversal is intentional and bounded: the source of truth becomes the DB; the TS files become first-boot seeders only.

## 2. Source of truth & seeding model

- **DB-only authoritative storage.** `collections.definition` (renamed from `blueprint_snapshot`) holds the full JSON blueprint shape. Every read and write of a blueprint goes through it.
- **TS files are first-boot seeders.** `apps/dev/blueprints/posts.ts` and `authors.ts` are imported once at startup. For each class whose `handle` does not already exist in `collections`, the seeder writes a row derived from the class. Subsequent boots ignore the files; admin edits win forever.
- **No special collections.** Unlike Statamic, no collection is privileged ("home", "site", etc.). Every blueprint — Posts, Authors, future Pages, future Settings — is the same shape.

## 3. Data model

### 3.1 Migration `006_blueprint_definitions.sql`

```sql
ALTER TABLE collections RENAME COLUMN blueprint_snapshot TO definition;
```

Forward-only. Existing dev databases must be wiped (`rm apps/dev/dev.db`); this is acceptable per the user's "we are just developing the cms at the moment" allowance.

`definition` stays `TEXT` (nullable at the SQL level — SQLite cannot retrofit `NOT NULL` via `ALTER COLUMN`, and rebuilding the table is not worth the scope here). The seeder runs before any read and populates `definition` for every existing handle; the loader and mutations treat the column as required at the application layer and refuse rows whose `definition` is null with a clear error.

### 3.2 Stored JSON shape

```ts
interface BlueprintDefinition {
  handle: string;                       // primary key in collections; immutable after create
  label: string;                        // display name in admin and meta endpoint
  singleton: boolean;                   // door open; v1 always false
  fields: FieldDefinition[];            // ordered; this is display order
}

interface FieldDefinition {
  name: string;                         // JSON key in entries.content
  label?: string;                       // display label; defaults to title-cased name
  ui: FieldUi;
  optional: boolean;
  default?: unknown;
  validation?: { min?: number; max?: number };  // text/textarea only
}

interface FieldUi {
  kind: 'text' | 'textarea' | 'blocks' | 'date' | 'boolean' | 'select' | 'relationship';
  options?: string[];                   // select only; ≥1 entry
  to?: string;                          // relationship only; must be an existing handle
}
```

`blueprint_hash` remains: sha256 over a stable JSON serialization of `definition`. Used by the seeder to detect drift and reserved for future dev/prod sync.

### 3.3 Data-on-edit semantics

- **Field rename.** When `updateBlueprint(handle, def)` detects a field with `previousName !== name`, the same transaction rewrites every matching `entries.content` JSON key via `json_set(json_remove(content, '$.<previousName>'), '$.<newName>', json_extract(content, '$.<previousName>'))`. No orphans.
- **Field remove.** The blueprint's `fields` array loses the entry. `entries.content` keeps the orphan JSON key on purpose — re-adding the same name brings the data back; otherwise it's invisible to the admin form but not lost.
- **Field retype.** No data migration. Existing entries that fail re-validation against the new Zod schema surface as normal `ValidationError` (422) on next save; users fix per-entry. The display table tolerates whatever JSON shape is in `content`.
- **Blueprint delete.** Cascades to `entries` via the existing FK (`ON DELETE CASCADE` on `entries.collection_handle`).

## 4. Core changes

### 4.1 Schema compiler

`packages/core/src/blueprints/compile.ts` — pure function. No DB, no IO.

```ts
export function compileBlueprint(def: BlueprintDefinition): Blueprint;
```

Per-kind base type:

| kind | base Zod type |
|---|---|
| `text` | `z.string()` (plus `min` / `max` if set) |
| `textarea` | `z.string()` (plus `min` / `max` if set) |
| `date` | `z.coerce.date()` |
| `boolean` | `z.boolean()` |
| `select` | `z.enum(options)` |
| `blocks` | `z.any()` |
| `relationship` | `z.string()` (target id) |

Modifier order: `optional` last, `default` before `optional`. Each field schema gets `.meta({ ui })` so the existing `/api/_meta/collections` extraction path is unchanged.

Returns a `Blueprint` matching the existing interface (`handle`, `label`, `schema`, `fields`, `hash`) so `ContentService` and the Hono content routes need no changes.

### 4.2 Loader rewrite

`packages/core/src/blueprints/load.ts` is rewritten. The new signature drops the directory argument:

```ts
export async function loadBlueprints(opts: { adapter: DatabaseAdapter }): Promise<Map<string, Blueprint>>;
```

It runs `SELECT handle, definition FROM collections`, runs each row through `compileBlueprint`, and returns the map. The class-scanning logic (dynamic `import()`, `Class.schema`, etc.) is removed from this file — it now lives only in the seeder (§4.3).

A second function is added:

```ts
export async function reloadBlueprint(handle: string, opts: { adapter: DatabaseAdapter }): Promise<Blueprint | null>;
```

Returns the single recompiled blueprint, used by the dev plugin so a single-blueprint edit doesn't have to re-read every row.

### 4.3 Seeder

`packages/core/src/blueprints/seed.ts` — new module.

```ts
export async function seedBlueprintsFromCode(opts: {
  adapter: DatabaseAdapter;
  dir: string;     // path to a directory of TS files exporting Collection subclasses
}): Promise<void>;
```

For each `.ts` (or `.js`) file in `dir`, dynamic-import the default export, check `cls.handle`, look it up in `collections`. If missing, insert a row whose `definition` JSON is derived from the class:

- `handle` ← `Class.handle`
- `label` ← `Class.label`
- `singleton` ← `false` (no equivalent on `Collection` yet; door open)
- `fields` ← walk `Class.schema.shape`:
  - `name` ← entry key
  - `label` ← title-cased name (`isFeatured` → `Is Featured`)
  - `ui` ← `.meta()?.ui`
  - `optional` ← `_zod?.optin === 'optional'` (same Zod-v4 internal the v1 loader used)
  - `default` ← `_def?.defaultValue?.()` (same as v1)
  - `validation` ← inspect `_def.checks` for `min` / `max` on strings

The seeder is idempotent (existence check by `handle`) and side-effect-free for handles that already have a row.

### 4.4 Mutation paths

`packages/core/src/blueprints/mutations.ts` — new module.

```ts
export async function createBlueprint(adapter: DatabaseAdapter, def: BlueprintDefinition): Promise<BlueprintDefinition>;
export async function updateBlueprint(adapter: DatabaseAdapter, handle: string, def: BlueprintDefinitionWithRenames): Promise<BlueprintDefinition>;
export async function deleteBlueprint(adapter: DatabaseAdapter, handle: string): Promise<void>;

type BlueprintDefinitionWithRenames = BlueprintDefinition & {
  fields: (FieldDefinition & { previousName?: string })[];
};
```

`updateBlueprint` runs inside one transaction:

1. Validate the incoming definition (see §4.5).
2. Build the rename map from `(previousName, name)` pairs where `previousName && previousName !== name`.
3. For each rename, `UPDATE entries SET content = json_set(json_remove(content, '$.<old>'), '$.<new>', json_extract(content, '$.<old>')) WHERE collection_handle = ? AND json_extract(content, '$.<old>') IS NOT NULL`.
4. Strip `previousName` from each field before persisting (canonical shape never contains it).
5. Recompute `blueprint_hash`.
6. `UPDATE collections SET definition = ?, blueprint_hash = ?, updated_at = datetime('now') WHERE handle = ?`.

After any mutation, mutations emit a `vulse:blueprints-changed` event on a small EventEmitter exported from core. The Vite dev plugin already listens for that (it uses the same event today for file-watched changes).

### 4.5 Definition validation

Centralised in a Zod schema `BlueprintDefinitionSchema` inside `mutations.ts`:

- `handle` matches `/^[a-z][a-z0-9_-]*$/`
- `label` is non-empty
- `fields` is non-empty
- field `name` values are unique within the blueprint and match `/^[a-zA-Z_][a-zA-Z0-9_]*$/`
- `select` fields have at least one option, all unique
- `relationship` fields have `to` pointing at a handle that exists at validation time (other than self on create)
- `previousName` (PATCH only) must refer to a name in the prior stored definition

Failures throw the existing `ValidationError(issues: ZodIssue[])`; the Hono error handler maps it to 422 unchanged.

## 5. API

New resource family alongside the existing `/api/collections/*` content routes:

| Verb | Path | Returns | Notes |
|---|---|---|---|
| GET | `/api/blueprints` | `BlueprintDefinition[]` | display order: by `created_at ASC` |
| GET | `/api/blueprints/:handle` | `BlueprintDefinition` | 404 if missing |
| POST | `/api/blueprints` | `BlueprintDefinition` | 201; rejects duplicate handle |
| PATCH | `/api/blueprints/:handle` | `BlueprintDefinition` | full replace; accepts per-field `previousName` |
| DELETE | `/api/blueprints/:handle` | _empty_ | 204; cascades to entries |

Response shape is the on-disk JSON shape from §3.2. Validation errors use the same `{ error: 'validation', issues: ZodIssue[] }` envelope. `handle` is immutable post-create — PATCH ignores any handle in the body and uses the URL param.

`/api/_meta/collections` continues to exist and to be the contract the content-authoring admin reads. It now derives from the same DB rows, so any blueprint mutation is visible to all content forms after the next request — no client-side cache to invalidate beyond Pinia's `useBlueprintsStore`.

PATCH request shape (renaming `title` to `headline`):

```jsonc
{
  "handle": "posts",
  "label": "Articles",
  "singleton": false,
  "fields": [
    { "name": "headline", "previousName": "title", "label": "Headline",
      "ui": { "kind": "text" }, "optional": false, "validation": { "min": 1 } },
    { "name": "body", "label": "Body",
      "ui": { "kind": "blocks" }, "optional": false }
  ]
}
```

## 6. Admin UI

### 6.1 Sidebar

Two top-level groups under "Vulse":

```
Collections        ← content authoring (existing)
  Posts
  Authors

Schema             ← NEW: blueprint editing
  Posts
  Authors
  + New collection
```

The Schema group lists the same handles as Collections, in the same order, but each link goes to the blueprint editor for that handle.

### 6.2 Routes

```
/schema                  → BlueprintList (a flat table of all blueprints; alt entry)
/schema/new              → BlueprintEditor (empty state, creating)
/schema/:handle          → BlueprintEditor (loaded for an existing blueprint)
```

### 6.3 Blueprint editor page

Single-page form:

1. **Header bar** — `handle` (read-only on edit; required + slug-cased on create), `label`, `singleton` checkbox.
2. **Fields list** — one card per field, in display order. Each card shows: name, kind badge, optional/required badge. Buttons: ↑ ↓ to reorder, ⤬ to remove, click anywhere else expands the detail panel.
3. **Field detail panel** (when expanded) — name, label, kind (select), optional checkbox, default (kind-aware), and kind-specific extras:
   - `text` / `textarea` → `validation.min`, `validation.max`
   - `select` → tag-style options editor (add/remove options)
   - `relationship` → `to` (dropdown of existing handles excluding self)
4. **Add field** button at the bottom of the list.
5. **Cancel** / **Save** at the page footer.

### 6.4 `previousName` tracking

When the editor loads, each existing field's `previousName` is shadowed equal to `name`. Typing into `name` updates only `name`. Newly added fields start with `previousName: null`. On submit, the client sends `previousName` only when it differs from `name` and is not null. The server uses it to compute the rename map (§4.4 step 2).

### 6.5 Constraints in v1

- `handle` is immutable post-create. Renaming a collection itself is a follow-up.
- Reordering is via **up/down buttons**, not drag-and-drop.
- No tabs / fieldsets.
- No conditional fields, no computed fields, no field-level RBAC.
- No multi-user concurrency handling (last write wins).

### 6.6 Test hooks

`data-testid` on:

- `blueprint-handle`, `blueprint-label`, `blueprint-singleton`
- per field card: `field-card-<name>` (root), `field-name-input`, `field-kind-select`, `field-optional`, `field-up`, `field-down`, `field-remove`
- `add-field`
- `blueprint-save`, `blueprint-cancel`

## 7. Boot order

`apps/dev/vite.config.ts` and `apps/dev/src/server.prod.ts` both call:

```ts
await runMigrations(adapter, MIGRATIONS_DIR);
await seedBlueprintsFromCode({ adapter, dir: blueprintsDir });   // NEW
const blueprints = await loadBlueprints({ adapter });             // signature change: no dir
const content = createContentService(adapter, blueprints);
const api = createApi({ blueprints, content });
```

The dev plugin's blueprint-changed listener re-runs `loadBlueprints` and rebuilds the Hono route table — same code path it already uses for file watcher events.

## 8. Testing

Per-package additions:

- **`packages/core/blueprints/compile.test.ts`** — pure unit. Every UI kind compiles to a working Zod validator; `optional`, `default`, `min`, `max` apply; `select` rejects values not in its options.
- **`packages/core/blueprints/seed.test.ts`** — libSQL integration. Seeding inserts rows for both fixture classes; second seed is a no-op; an admin-style edit between seeds is preserved across the second seed.
- **`packages/core/blueprints/mutations.test.ts`** — libSQL integration. `createBlueprint` rejects duplicates / invalid handles / empty fields / duplicate field names / unknown relationship targets. `updateBlueprint` writes the new definition and the rename rewrites `entries.content` JSON keys; orphan data for removed fields persists. `deleteBlueprint` cascades to entries.
- **`packages/core/http/blueprints.api.test.ts`** — Hono in-memory tests, 200 / 201 / 204 / 404 / 422 across the five endpoints.
- **`packages/admin/components/__tests__/BlueprintEditor.test.ts`** — narrow behavior tests: add appends, remove removes, up/down reorders, kind switch shows kind-specific inputs, submit sends `previousName` only when it differs and is not null.
- **`apps/dev/src/smoke.test.ts`** — gains a third assertion: rename `title` → `headline` via PATCH `/api/blueprints/posts`, then GET `/api/_meta/collections` reflects the new name, then POSTing content with `headline` succeeds.

### Out of scope for v1 tests

- DnD reordering (no DnD).
- Migrations of data on retype (no migration).
- Visual regression.
- Multi-user concurrency.

## 9. Out of scope (this iteration)

- Renaming a `handle` after create.
- Drag-and-drop reordering.
- Fieldsets / tabs.
- Conditional, computed, or RBAC'd fields.
- Singleton enforcement (the column exists; v1 always writes `false`).
- Dev/prod blueprint sync via `blueprint_hash`.
- Export current DB blueprints back to TS files.

These are all door-open: nothing in v1 forecloses them.

## 10. Migration / cleanup

- Run migration `006_blueprint_definitions.sql`. Dev DBs must be wiped (`rm apps/dev/dev.db`) — the column rename has no `IF NOT EXISTS` and we are not building backwards-compat handling.
- After this iteration lands, `apps/dev/blueprints/posts.ts` and `authors.ts` are seed-only. Editing them post-seed has no effect.
- `packages/core/blueprints/__fixtures__/*.ts` stays — used by `seed.test.ts` as a fixture directory.
- `packages/core/blueprints/collection.ts` (the `Collection` base class) stays — still the seed source-of-truth on fresh installs.
