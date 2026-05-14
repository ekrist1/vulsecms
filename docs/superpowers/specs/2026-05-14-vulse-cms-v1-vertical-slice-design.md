# Vulse CMS — v1 Vertical Slice Design

**Date:** 2026-05-14
**Status:** Approved (brainstorming phase)
**Scope:** Greenfield monorepo scaffold through the first working vertical slice — blueprint-defined collections, generated REST API, and admin UI.

## 1. Goal

Deliver a Vue/Vite-based headless CMS where a developer can:

1. Define a collection in a TypeScript blueprint file (class-based, Zod schema).
2. Run a single command to start the CMS — Hono API + Vite admin both come up.
3. See the collection in the admin sidebar; CRUD entries through the UI.
4. Fetch entries via `GET /api/collections/:handle` and `GET /api/collections/:handle/:id` as plain JSON arrays/objects.
5. Author block content with TipTap; the JSON output renders unchanged via `@vulse/renderer`.

Anything outside that list is out of scope for v1 (see §11).

## 2. Tech stack (locked)

| Concern | Choice |
|---|---|
| Runtime | Node.js 22+ |
| Language | TypeScript, strict mode, NodeNext modules |
| Frontend | Vue 3 (Composition API only), Vite, Tailwind CSS v4 |
| Component primitives | Reka UI |
| Routing / state (admin) | vue-router + Pinia |
| Database | Turso / libSQL via `@libsql/client` |
| Validation | Zod v4 (uses `.meta()` API) |
| HTTP layer | Hono |
| Block editor | TipTap v2 (`@tiptap/vue-3` + `@tiptap/starter-kit`) + custom `vulseCallout` node |
| Build / dev | Vite+ (`vp`) |
| Tests | Vitest (one workspace config) |
| Lint / format | Biome |
| Package manager | pnpm workspaces |
| ID generation | ULID (client-side; opaque TEXT to libSQL) |

## 3. Monorepo layout

```
vulsecms/
├── package.json                 # workspace root
├── pnpm-workspace.yaml          # packages/*, apps/*
├── tsconfig.base.json           # strict, NodeNext, path aliases
├── biome.json
├── vitest.workspace.ts
├── .gitignore                   # node_modules, dist, *.db, *.db-shm, *.db-wal
├── docs/superpowers/specs/      # this file lives here
├── packages/
│   ├── db/                      # DatabaseAdapter contract + libSQL impl + migrations
│   ├── core/                    # blueprint loader, content service, Hono API factory
│   ├── renderer/                # zero-deps-on-core Vue renderer for block JSON
│   └── admin/                   # schema-agnostic Vue 3 admin SPA
└── apps/
    └── dev/                     # sandbox: blueprints/, vulse.config.ts, `vp dev` entry
```

Each package: own `package.json`, `tsconfig.json` extending base, `vite.config.ts` or `vitest.config.ts`. Cross-package references via `workspace:*`.

## 4. `packages/db`: adapter contract first

### 4.1 DatabaseAdapter interface

Defined before any persistence logic. All other packages depend on this interface, never on the libSQL implementation.

```ts
export interface DatabaseAdapter {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export type Row = Record<string, unknown>;
```

### 4.2 LibsqlAdapter

Implements the interface via `@libsql/client`. Constructor takes a libSQL config object (`{ url, authToken? }`). Local dev uses `file:./dev.db`; production uses a Turso URL. The implementation is the only file in the workspace that imports `@libsql/client`.

### 4.3 Migration runner

`packages/db/src/migrate.ts` accepts a directory and an adapter. It:

1. Ensures a `_vulse_migrations` table exists (`name TEXT PRIMARY KEY, applied_at`).
2. Reads `*.sql` files in lexicographic order.
3. Applies each unapplied migration inside a transaction; records the file name.
4. Is idempotent — re-running is a no-op.

No `down` migrations. (Door closed until needed.)

### 4.4 Schema (v1 migrations)

All five ship in v1. Only `collections` and `entries` are used by v1 application code; the rest are doors-open tables.

**`001_collections.sql`** — blueprint registry mirror (blueprints themselves live as TS files; this table records what we've seen).

```sql
CREATE TABLE collections (
  handle              TEXT PRIMARY KEY,
  blueprint_hash      TEXT NOT NULL,
  blueprint_snapshot  TEXT,                     -- nullable JSON snapshot, unused in v1
  singleton           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**`002_entries.sql`** — content rows; parent/child + ordering baked in.

```sql
CREATE TABLE entries (
  id                  TEXT PRIMARY KEY,                                  -- ULID
  collection_handle   TEXT NOT NULL REFERENCES collections(handle) ON DELETE CASCADE,
  parent_id           TEXT REFERENCES entries(id) ON DELETE CASCADE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'published',
  content             TEXT NOT NULL,                                     -- JSON
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_entries_scope     ON entries(collection_handle, parent_id, sort_order);
CREATE INDEX idx_entries_status    ON entries(collection_handle, status);
```

v1 always writes `status = 'published'`. The list endpoint returns a flat ordered list (`ORDER BY sort_order ASC, created_at DESC`). No tree walking or drag-reorder in v1.

**`003_revisions.sql`** — entry history; door open.

```sql
CREATE TABLE revisions (
  id                  TEXT PRIMARY KEY,
  entry_id            TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  revision_number     INTEGER NOT NULL,
  content             TEXT NOT NULL,                                     -- full snapshot
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  created_by          TEXT                                               -- nullable; auth comes later
);
CREATE INDEX idx_revisions_entry ON revisions(entry_id, revision_number DESC);
```

Nothing in v1 writes to this table. The seam in `ContentService.update()` is a single commented line — not a stubbed function.

**`004_navigation.sql`** — nav trees; door open.

```sql
CREATE TABLE navigation (
  handle              TEXT PRIMARY KEY,
  tree                TEXT NOT NULL,                                     -- JSON tree
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**`005_settings.sql`** — global key/value; door open.

```sql
CREATE TABLE settings (
  key                 TEXT PRIMARY KEY,                                  -- dotted: 'site.title'
  value               TEXT NOT NULL,                                     -- JSON-encoded
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## 5. `packages/core`: blueprint loader, content service, Hono API

### 5.1 Blueprint definition (class + Zod schema)

```ts
import { Collection } from '@vulse/core';
import { z } from 'zod';

export default class Posts extends Collection {
  static handle = 'posts';
  static label  = 'Posts';

  static schema = z.object({
    title:      z.string().min(1).meta({ ui: { kind: 'text' } }),
    slug:       z.string().min(1).meta({ ui: { kind: 'text' } }),
    excerpt:    z.string().optional().meta({ ui: { kind: 'textarea' } }),
    body:       z.array(z.any()).meta({ ui: { kind: 'blocks' } }),
    publishAt:  z.coerce.date().optional().meta({ ui: { kind: 'date' } }),
    isFeatured: z.boolean().default(false).meta({ ui: { kind: 'boolean' } }),
    status:     z.enum(['draft','published']).meta({ ui: { kind: 'select' } }),
    author:     z.string().meta({ ui: { kind: 'relationship', to: 'authors' } }),
  });
}
```

- One Zod schema is the single source of truth for both validation and admin UI hints.
- The base `Collection` class is exported from `@vulse/core`; v1 leaves it intentionally empty (door open for `beforeCreate`, `afterUpdate`, computed fields, etc.).

### 5.2 Blueprint loader

`loadBlueprints(dir, { adapter })`:

1. Globs `<dir>/*.ts`.
2. Dynamic-imports each file. In dev, Vite's SSR module loader handles transformation (HMR for free); in prod, blueprints are bundled at build time.
3. Reads `Class.handle`, `Class.label`, `Class.schema`. Walks `schema.shape` to extract `meta.ui` per field.
4. Computes `blueprint_hash` = sha256 over a stable JSON serialization of `{ handle, fields: [{ name, ui, optional, default }] }`.
5. Upserts the row in `collections` (`ON CONFLICT(handle) DO UPDATE`).
6. Returns `Map<handle, Blueprint>` for the rest of core.

Dev HMR: the Vite plugin watches `blueprints/**` and rebuilds the route table, broadcasting an HMR event the admin's blueprint store listens for.

### 5.3 Content service

Pure functions over `DatabaseAdapter` + `Blueprint`. No HTTP knowledge.

```ts
export interface ContentService {
  list(handle: string, opts?: { limit?: number; offset?: number }): Promise<Entry[]>;
  get(handle: string, id: string): Promise<Entry | null>;
  create(handle: string, input: unknown): Promise<Entry>;
  update(handle: string, id: string, input: unknown): Promise<Entry>;
  delete(handle: string, id: string): Promise<void>;
}

export interface Entry {
  id: string;
  collection: string;
  parentId: string | null;
  sortOrder: number;
  status: string;
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

- Validation always runs through the blueprint's Zod schema. Failures throw `ValidationError` carrying the `ZodIssue[]`.
- `create` generates a ULID, sets `sort_order = (max in (collection, parent) scope) + 1`, status defaults to `'published'`.
- The relationship field stores the target entry ID and returns it unchanged. No expansion in v1.

### 5.4 Hono API factory

```ts
export function createApi({ blueprints, content }: ApiDeps): Hono {
  const app = new Hono();
  app.use('*', cors());                       // gated by env in prod
  app.onError(errorHandler);                  // ValidationError → 422, NotFound → 404

  for (const [handle, blueprint] of blueprints) {
    app.get(   `/api/collections/${handle}`,        c => listHandler(c, handle, content));
    app.get(   `/api/collections/${handle}/:id`,    c => getHandler(c, handle, content));
    app.post(  `/api/collections/${handle}`,        c => createHandler(c, handle, content));
    app.patch( `/api/collections/${handle}/:id`,    c => updateHandler(c, handle, content));
    app.delete(`/api/collections/${handle}/:id`,    c => deleteHandler(c, handle, content));
  }

  app.get('/api/_meta/collections', c => c.json([...blueprints.values()].map(toMeta)));
  return app;
}
```

**Response shapes** — plain JSON, no envelope:

```jsonc
// GET /api/collections/posts
[
  {
    "id": "01H...",
    "collection": "posts",
    "parentId": null,
    "sortOrder": 0,
    "status": "published",
    "content": { "title": "Hello", "slug": "hello", ... },
    "createdAt": "2026-05-14T...",
    "updatedAt": "2026-05-14T..."
  }
]
```

**Error shape** (422 example):

```json
{ "error": "validation", "issues": [/* ZodIssue[] */] }
```

`/api/_meta/collections` returns the data the admin needs to render forms — `{ handle, label, fields: [{ name, ui, optional, default }] }[]`. The admin has zero schema knowledge baked in; it discovers everything from this endpoint.

## 6. `packages/admin`: schema-agnostic Vue 3 SPA

### 6.1 Directory layout

```
packages/admin/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── src/
│   ├── main.ts                      # bootstrap: Pinia, router, Tailwind
│   ├── App.vue                      # <Sidebar/> + <RouterView/>
│   ├── router.ts                    # routes generated after blueprint store hydrates
│   ├── api/client.ts                # tiny fetch wrapper
│   ├── stores/
│   │   ├── blueprints.ts            # Pinia: blueprint meta + derived nav
│   │   └── entries.ts               # Pinia: per-collection cache
│   ├── components/
│   │   ├── layout/Sidebar.vue       # commented-out slots for Navigation/Settings groups
│   │   ├── fields/
│   │   │   ├── TextField.vue
│   │   │   ├── TextareaField.vue
│   │   │   ├── BlocksField.vue      # TipTap host
│   │   │   ├── DateField.vue
│   │   │   ├── BooleanField.vue
│   │   │   ├── SelectField.vue
│   │   │   └── RelationshipField.vue
│   │   ├── FieldRenderer.vue        # switch on field.ui.kind
│   │   └── ui/                      # Reka UI wrappers
│   └── pages/
│       ├── CollectionList.vue
│       └── CollectionEntry.vue
```

### 6.2 Routes

- `/` → redirect to first collection
- `/collections/:handle` → `CollectionList`
- `/collections/:handle/new` → `CollectionEntry` (empty form)
- `/collections/:handle/:id` → `CollectionEntry` (loaded form)

Routes mount after `useBlueprintsStore().hydrate()` resolves.

### 6.3 Form pipeline

`CollectionEntry.vue`:

1. Read blueprint from store.
2. Fetch entry by id, or initialize from Zod defaults exposed in the meta.
3. For each field, render `<FieldRenderer :name :meta v-model="state[name]" :error="errors[name]"/>`.
4. On submit: POST/PATCH the raw `state`. Server is the validator. 422 responses map issues to field names; the form surfaces them inline. No client-side Zod duplication in v1.

### 6.4 TipTap integration

- `BlocksField.vue` uses `@tiptap/vue-3` + `@tiptap/starter-kit`.
- One custom node: `vulseCallout`, attrs `{ tone: 'info' | 'warn' }`, inline content. Toolbar button inserts it.
- `editor.getJSON()` is the wire format stored verbatim in `entry.content.body`.

### 6.5 Reka UI

Thin wrappers in `components/ui/*.vue` over `Dialog`, `Select`, `Toast`, `DropdownMenu`, `Tooltip`. Tailwind class composition. Future shadcn-vue migration stays trivial.

### 6.6 Test hooks

Every route and key control has a stable `data-testid`. No Playwright tests in v1, but the door is open.

## 7. `packages/renderer`: JSON → Vue

**Strict isolation:** zero dependencies on `core` or `admin`. Peer dep on `vue`. Nothing else.

### 7.1 Public surface

```ts
export { default as BlockRenderer } from './BlockRenderer.vue';
export type { BlockNode, BlockRendererProps, BlockComponentMap };

export interface BlockNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: BlockNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}
```

`BlockNode` is TipTap's `getJSON()` shape verbatim — no transformation layer.

### 7.2 Usage

```vue
<BlockRenderer :doc="entry.content.body" />
<BlockRenderer :doc="entry.content.body" :components="{ vulseCallout: MyCallout }" />
```

The dispatcher merges a built-in component map with user overrides; unknown node types render nothing and log a dev-only warning.

### 7.3 Default components

`packages/renderer/src/blocks/`: `Paragraph.vue`, `Heading.vue`, `BulletList.vue`, `OrderedList.vue`, `ListItem.vue`, `Blockquote.vue`, `CodeBlock.vue`, `HardBreak.vue`, `Text.vue` (leaf, applies `bold` / `italic` / `code` / `link` marks), `VulseCallout.vue`.

### 7.4 Styles

Minimal `packages/renderer/styles/renderer.css`, optional import (`@vulse/renderer/styles`). Typographic resets + `vulseCallout` tone variants. No page-level layout opinions.

## 8. `apps/dev`: the sandbox

```
apps/dev/
├── package.json                    # scripts: dev, build, start
├── vite.config.ts                  # uses vulseDevPlugin
├── vite.config.server.ts           # production server build
├── vulse.config.ts                 # { blueprintsDir, database }
├── blueprints/
│   ├── posts.ts
│   └── authors.ts
├── src/
│   ├── main.ts                     # admin app entry (imports @vulse/admin)
│   └── server.prod.ts              # ~30 lines: @hono/node-server + serve built admin
└── dev.db                          # gitignored
```

## 9. Dev orchestration — Vite middleware mode

A single `vp dev` in `apps/dev/` boots both servers on one port via `vulseDevPlugin` (exported from `@vulse/core/vite`):

```ts
// apps/dev/vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { vulseDevPlugin } from '@vulse/core/vite';

export default defineConfig({
  plugins: [
    vue(),
    vulseDevPlugin({
      blueprintsDir: './blueprints',
      database: { url: 'file:./dev.db' },
    }),
  ],
});
```

`vulseDevPlugin.configureServer`:

1. Loads blueprints via Vite's SSR module loader.
2. Creates the `LibsqlAdapter`; runs migrations.
3. Builds the Hono app via `createApi(...)` and mounts it as Node middleware under `/api/*`.
4. Watches `blueprints/**` and rebuilds routes on change, broadcasting an HMR custom event the admin's blueprint store consumes.

**Production**: `vp build` produces the admin bundle; a second pass builds `server.prod.ts`. `node dist/server/server.prod.js` runs `@hono/node-server` against the same `createApi(...)` factory, serving the built admin statically.

## 10. Testing strategy

One Vitest workspace at the repo root. Each package configures its own environment.

- **`packages/db`** — integration tests against `:memory:` libSQL. Adapter round-trips, full migration apply + idempotency check, parent/child + sort_order behavior, ON DELETE CASCADE.
- **`packages/core`** — blueprint loader (load fixture dir, hash stability), `ContentService` CRUD against `:memory:` libSQL + migrations, Hono API tested via `app.request(new Request(...))`, error mapping (validation → 422, not found → 404).
- **`packages/renderer`** — jsdom. Snapshot per default node, marks composition, custom-component override, full-doc round-trip with `vulseCallout`.
- **`packages/admin`** — narrow behavior tests. Blueprint store hydration from a mocked `/api/_meta/collections`, `FieldRenderer` dispatch, `RelationshipField` option fetching. No page snapshots; no E2E in v1.
- **`apps/dev`** — one smoke test that boots the Vite dev server programmatically, hits `/api/_meta/collections`, asserts fixture blueprints appear.

CI: `vp check` (Biome + tsc) + `vp test`. Node 22 only; no matrix yet.

## 11. Out of scope for v1

Not built (and not stubbed):

- User authentication / sessions / RBAC
- Media / asset management
- Versioning UI (table exists, no writes)
- Multi-language
- Plugins / themes
- Navigation editor (table exists, no UI)
- Globals / settings UI (table exists, no UI)
- Forms / form-builder
- Public-facing frontend
- Tree views, drag-to-reorder
- Relationship expansion (`?include=...`)
- E2E browser tests
- Migration `down` operations

## 12. Open doors (intentional design hooks)

- `Collection` base class is empty but extensible (lifecycle hooks).
- `entries.status`, `parent_id`, `sort_order` columns exist with v1 defaults.
- `revisions`, `navigation`, `settings` tables exist with no writes.
- `collections.singleton` and `collections.blueprint_snapshot` columns exist unused.
- Admin sidebar has commented-out slots for Navigation/Settings groups.
- `data-testid` attributes on every admin route/control.
- Hono error envelope (`{ error, issues }`) is forward-compatible with auth errors, permission errors, etc.

## 13. Build / package scripts

Root `package.json`:

```json
{
  "scripts": {
    "dev":   "pnpm --filter @vulse/dev dev",
    "build": "pnpm -r build",
    "check": "vp check && biome check .",
    "test":  "vitest run",
    "lint":  "biome check .",
    "format":"biome format --write ."
  }
}
```

Each package exposes `vp`-driven `build`, `check`, `test`. `apps/dev` additionally exposes `dev` and `start`.
