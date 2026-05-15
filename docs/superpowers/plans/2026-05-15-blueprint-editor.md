# Blueprint Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move blueprint definitions from TypeScript files into the database and expose a Statamic-style visual editor in the admin UI, with seamless seeding from the existing TS classes on first boot.

**Architecture:** A JSON `definition` column in the existing `collections` table becomes the source of truth. A new `compileBlueprint` step converts that JSON into the Zod-backed `Blueprint` the rest of the system already consumes. A small `EventEmitter` on `@vulse/core` lets the Vite dev plugin and the prod server rebuild routes after API mutations.

**Tech Stack:** Same as the v1 vertical slice — Node 22+, TypeScript strict, Vue 3 Composition API, Vite, Tailwind v4 + Reka UI, vue-router, Pinia, Zod v4, Hono, `@libsql/client`, Vitest, Biome.

**Reference spec:** `docs/superpowers/specs/2026-05-15-blueprint-editor-design.md`

---

## Phase A — Migration

### Task A1: Add migration `006_blueprint_definitions.sql`

**Files:**
- Create: `packages/db/migrations/006_blueprint_definitions.sql`

- [ ] **Step 1: Create the migration file**

```sql
ALTER TABLE collections RENAME COLUMN blueprint_snapshot TO definition;
```

- [ ] **Step 2: Wipe local dev DB so the migration runner picks the new column name**

Run: `rm -f apps/dev/dev.db apps/dev/dev.db-shm apps/dev/dev.db-wal`
Expected: files gone (or weren't there).

- [ ] **Step 3: Re-run the existing schema test to confirm migrations still apply cleanly**

Run: `pnpm --filter @vulse/db test`
Expected: 10/10 pass — `packages/db/src/schema.test.ts` already creates a fresh `:memory:` DB and applies all migrations; the new file is picked up automatically because the runner reads `*.sql` lexicographically.

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations
git commit -m "feat(db): migration 006 renames collections.blueprint_snapshot to definition"
```

---

## Phase B — Core

### Task B1: Definition types + validation schema

**Files:**
- Create: `packages/core/src/blueprints/definition.ts`
- Modify: `packages/core/src/blueprints/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/src/blueprints/definition.ts`**

```ts
import { z } from 'zod';

// Stored JSON shape for a blueprint. The same shape is returned by the
// /api/blueprints endpoints and consumed by the admin editor.

export const FieldUiSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text') }),
  z.object({ kind: z.literal('textarea') }),
  z.object({ kind: z.literal('blocks') }),
  z.object({ kind: z.literal('date') }),
  z.object({ kind: z.literal('boolean') }),
  z.object({ kind: z.literal('select'), options: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('relationship'), to: z.string().min(1) }),
]);

export const FieldValidationSchema = z
  .object({
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().positive().optional(),
  })
  .optional();

export const FieldDefinitionSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  label: z.string().optional(),
  ui: FieldUiSchema,
  optional: z.boolean(),
  default: z.unknown().optional(),
  validation: FieldValidationSchema,
});

export const BlueprintDefinitionSchema = z.object({
  handle: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  label: z.string().min(1),
  singleton: z.boolean(),
  fields: z.array(FieldDefinitionSchema).min(1),
});

export type FieldUi = z.infer<typeof FieldUiSchema>;
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;
export type BlueprintDefinition = z.infer<typeof BlueprintDefinitionSchema>;

// PATCH body adds previousName per field (server-only; stripped before persisting).
export const FieldDefinitionWithRenameSchema = FieldDefinitionSchema.extend({
  previousName: z.string().optional(),
});
export const BlueprintDefinitionWithRenamesSchema = BlueprintDefinitionSchema.extend({
  fields: z.array(FieldDefinitionWithRenameSchema).min(1),
});
export type FieldDefinitionWithRename = z.infer<typeof FieldDefinitionWithRenameSchema>;
export type BlueprintDefinitionWithRenames = z.infer<typeof BlueprintDefinitionWithRenamesSchema>;
```

- [ ] **Step 2: Replace `packages/core/src/blueprints/types.ts` so `Blueprint.fields` carries the full definition shape**

```ts
import type { z } from 'zod';
import type { FieldDefinition, FieldUi } from './definition.js';

export type { FieldUi, FieldDefinition } from './definition.js';

// Backwards-compat alias: prior code referred to FieldMeta. Keep it as an
// alias for FieldDefinition so the admin client code keeps compiling.
export type FieldMeta = FieldDefinition;

export interface Blueprint {
  handle: string;
  label: string;
  singleton: boolean;
  schema: z.ZodObject<z.ZodRawShape>;
  fields: FieldDefinition[];
  hash: string;
}
```

- [ ] **Step 3: Re-export the new types from `packages/core/src/index.ts`**

Open `packages/core/src/index.ts` and replace its full contents with:

```ts
export { Collection } from './blueprints/collection.js';
export type { Blueprint, FieldMeta, FieldUi, FieldDefinition } from './blueprints/types.js';
export {
  BlueprintDefinitionSchema,
  BlueprintDefinitionWithRenamesSchema,
  FieldDefinitionSchema,
  FieldUiSchema,
  type BlueprintDefinition,
  type BlueprintDefinitionWithRenames,
  type FieldDefinitionWithRename,
} from './blueprints/definition.js';
export { loadBlueprints, reloadBlueprint, type LoadOptions } from './blueprints/load.js';
export { seedBlueprintsFromCode } from './blueprints/seed.js';
export {
  createBlueprint,
  updateBlueprint,
  deleteBlueprint,
} from './blueprints/mutations.js';
export { blueprintEvents } from './events.js';
export { createContentService } from './content/service.js';
export type { ContentService, Entry } from './content/types.js';
export { createApi, type ApiDeps } from './http/api.js';
export { toMeta, type BlueprintMeta } from './http/meta.js';
export { ValidationError, NotFoundError } from './errors.js';
```

(The imports for `loadBlueprints`, `seedBlueprintsFromCode`, `mutations`, `events` will be created in later tasks. After this commit, `pnpm --filter @vulse/core check` will fail — that's intentional; the next task fixes it.)

- [ ] **Step 4: Verify typecheck on just the definition module compiles in isolation**

Run: `pnpm exec tsc --noEmit -p packages/core/tsconfig.json packages/core/src/blueprints/definition.ts 2>&1 | head -20 || true`
Expected: no errors specific to `definition.ts`. (The full-package check still fails because of missing modules referenced from `index.ts`; that's resolved by subsequent tasks.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/blueprints/definition.ts packages/core/src/blueprints/types.ts packages/core/src/index.ts
git commit -m "feat(core): add BlueprintDefinition Zod schemas (stored JSON shape)"
```

---

### Task B2: Schema compiler — TDD

**Files:**
- Create: `packages/core/src/blueprints/compile.test.ts`
- Create: `packages/core/src/blueprints/compile.ts`

- [ ] **Step 1: Write failing test `packages/core/src/blueprints/compile.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { compileBlueprint } from './compile.js';
import type { BlueprintDefinition } from './definition.js';

function bp(overrides: Partial<BlueprintDefinition> = {}): BlueprintDefinition {
  return {
    handle: 'posts',
    label: 'Posts',
    singleton: false,
    fields: [],
    ...overrides,
  };
}

describe('compileBlueprint', () => {
  it('compiles a text field with min/max', () => {
    const b = compileBlueprint(
      bp({
        fields: [
          { name: 'title', ui: { kind: 'text' }, optional: false, validation: { min: 1, max: 10 } },
        ],
      }),
    );
    expect(b.schema.safeParse({ title: 'ok' }).success).toBe(true);
    expect(b.schema.safeParse({ title: '' }).success).toBe(false);
    expect(b.schema.safeParse({ title: 'too long string' }).success).toBe(false);
  });

  it('compiles an optional textarea', () => {
    const b = compileBlueprint(
      bp({ fields: [{ name: 'bio', ui: { kind: 'textarea' }, optional: true }] }),
    );
    expect(b.schema.safeParse({}).success).toBe(true);
    expect(b.schema.safeParse({ bio: 'hi' }).success).toBe(true);
  });

  it('compiles a date field via coercion', () => {
    const b = compileBlueprint(
      bp({ fields: [{ name: 'publishAt', ui: { kind: 'date' }, optional: false }] }),
    );
    expect(b.schema.safeParse({ publishAt: '2026-01-01' }).success).toBe(true);
    expect(b.schema.safeParse({ publishAt: 'not a date' }).success).toBe(false);
  });

  it('compiles a boolean with a default', () => {
    const b = compileBlueprint(
      bp({
        fields: [{ name: 'isFeatured', ui: { kind: 'boolean' }, optional: false, default: false }],
      }),
    );
    const out = b.schema.safeParse({});
    expect(out.success).toBe(true);
    if (out.success) expect(out.data).toEqual({ isFeatured: false });
  });

  it('compiles a select that rejects values outside its options', () => {
    const b = compileBlueprint(
      bp({
        fields: [
          {
            name: 'status',
            ui: { kind: 'select', options: ['draft', 'published'] },
            optional: false,
          },
        ],
      }),
    );
    expect(b.schema.safeParse({ status: 'draft' }).success).toBe(true);
    expect(b.schema.safeParse({ status: 'archived' }).success).toBe(false);
  });

  it('compiles blocks as z.any() (accepts any shape)', () => {
    const b = compileBlueprint(
      bp({ fields: [{ name: 'body', ui: { kind: 'blocks' }, optional: false }] }),
    );
    expect(b.schema.safeParse({ body: { type: 'doc', content: [] } }).success).toBe(true);
  });

  it('compiles relationship as a string id', () => {
    const b = compileBlueprint(
      bp({
        fields: [
          { name: 'author', ui: { kind: 'relationship', to: 'authors' }, optional: false },
        ],
      }),
    );
    expect(b.schema.safeParse({ author: 'ulid-here' }).success).toBe(true);
    expect(b.schema.safeParse({ author: 123 }).success).toBe(false);
  });

  it('attaches ui meta to each field for the loader to extract', () => {
    const b = compileBlueprint(
      bp({ fields: [{ name: 'title', ui: { kind: 'text' }, optional: false }] }),
    );
    expect(b.fields[0]).toMatchObject({ name: 'title', ui: { kind: 'text' } });
  });

  it('produces a 64-char sha256 hash that is stable across compilations', () => {
    const def = bp({ fields: [{ name: 'title', ui: { kind: 'text' }, optional: false }] });
    const a = compileBlueprint(def);
    const c = compileBlueprint(def);
    expect(a.hash).toHaveLength(64);
    expect(a.hash).toBe(c.hash);
  });
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `pnpm --filter @vulse/core test compile`
Expected: FAIL (module `./compile.js` missing).

- [ ] **Step 3: Implement `packages/core/src/blueprints/compile.ts`**

```ts
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Blueprint } from './types.js';
import type { BlueprintDefinition, FieldDefinition } from './definition.js';

export function compileBlueprint(def: BlueprintDefinition): Blueprint {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of def.fields) {
    shape[f.name] = compileField(f);
  }
  const schema = z.object(shape);
  return {
    handle: def.handle,
    label: def.label,
    singleton: def.singleton,
    fields: def.fields,
    schema,
    hash: hashDefinition(def),
  };
}

function compileField(f: FieldDefinition): z.ZodTypeAny {
  let s: z.ZodTypeAny;
  switch (f.ui.kind) {
    case 'text':
    case 'textarea': {
      let str = z.string();
      if (f.validation?.min !== undefined) str = str.min(f.validation.min);
      if (f.validation?.max !== undefined) str = str.max(f.validation.max);
      s = str;
      break;
    }
    case 'date':
      s = z.coerce.date();
      break;
    case 'boolean':
      s = z.boolean();
      break;
    case 'select':
      s = z.enum(f.ui.options as [string, ...string[]]);
      break;
    case 'blocks':
      s = z.any();
      break;
    case 'relationship':
      s = z.string();
      break;
  }
  if (f.default !== undefined) s = s.default(f.default);
  if (f.optional) s = s.optional();
  return s.meta({ ui: f.ui });
}

export function hashDefinition(def: BlueprintDefinition): string {
  const canonical = JSON.stringify({
    handle: def.handle,
    label: def.label,
    singleton: def.singleton,
    fields: def.fields.map((f) => ({
      name: f.name,
      label: f.label ?? null,
      ui: f.ui,
      optional: f.optional,
      default: f.default ?? null,
      validation: f.validation ?? null,
    })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}
```

- [ ] **Step 4: Run test — verify pass**

Run: `pnpm --filter @vulse/core test compile`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/blueprints
git commit -m "feat(core): compileBlueprint produces Zod schema from BlueprintDefinition JSON"
```

---

### Task B3: Event bus

**Files:**
- Create: `packages/core/src/events.ts`

- [ ] **Step 1: Implement `packages/core/src/events.ts`**

```ts
import { EventEmitter } from 'node:events';

// Singleton event bus for blueprint changes. The Vite dev plugin and prod
// server both subscribe so they can reload blueprints after admin mutations.
export const blueprintEvents = new EventEmitter();

export type BlueprintChangeEvent = { handle: string; kind: 'create' | 'update' | 'delete' };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @vulse/core check 2>&1 | head -5`
Expected: still failing on `seedBlueprintsFromCode`/`mutations.js` imports from `index.ts` — those land in B4/B5. No new errors specific to `events.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/events.ts
git commit -m "feat(core): EventEmitter bus for blueprint mutations"
```

---

### Task B4: Loader rewrite + seeder — TDD

**Files:**
- Create: `packages/core/src/blueprints/seed.ts`
- Create: `packages/core/src/blueprints/seed.test.ts`
- Modify: `packages/core/src/blueprints/load.ts`
- Modify: `packages/core/src/blueprints/load.test.ts`

- [ ] **Step 1: Rewrite `packages/core/src/blueprints/load.ts`**

Replace the file's full contents with:

```ts
import type { DatabaseAdapter } from '@vulse/db';
import type { Blueprint } from './types.js';
import { BlueprintDefinitionSchema, type BlueprintDefinition } from './definition.js';
import { compileBlueprint } from './compile.js';

export interface LoadOptions {
  adapter: DatabaseAdapter;
}

export async function loadBlueprints(opts: LoadOptions): Promise<Map<string, Blueprint>> {
  const rows = await opts.adapter.query<{ handle: string; definition: string | null }>(
    'SELECT handle, definition FROM collections ORDER BY created_at ASC',
  );
  const map = new Map<string, Blueprint>();
  for (const row of rows) {
    if (!row.definition) {
      throw new Error(`collection '${row.handle}' has no definition; run seedBlueprintsFromCode first`);
    }
    const parsed = JSON.parse(row.definition);
    const def: BlueprintDefinition = BlueprintDefinitionSchema.parse(parsed);
    map.set(def.handle, compileBlueprint(def));
  }
  return map;
}

export async function reloadBlueprint(handle: string, opts: LoadOptions): Promise<Blueprint | null> {
  const row = await opts.adapter.queryOne<{ definition: string | null }>(
    'SELECT definition FROM collections WHERE handle = ?',
    [handle],
  );
  if (!row || !row.definition) return null;
  const def: BlueprintDefinition = BlueprintDefinitionSchema.parse(JSON.parse(row.definition));
  return compileBlueprint(def);
}
```

- [ ] **Step 2: Implement `packages/core/src/blueprints/seed.ts`**

```ts
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { z } from 'zod';
import type { DatabaseAdapter } from '@vulse/db';
import { Collection } from './collection.js';
import { hashDefinition } from './compile.js';
import type { BlueprintDefinition, FieldDefinition, FieldUi } from './definition.js';

export interface SeedOptions {
  adapter: DatabaseAdapter;
  dir: string;
}

export async function seedBlueprintsFromCode(opts: SeedOptions): Promise<void> {
  const files = (await readdir(opts.dir))
    .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.js'))
    .filter((f) => !f.startsWith('_'));

  for (const file of files) {
    const mod = await import(pathToFileURL(resolve(opts.dir, file)).href);
    const cls = mod.default as typeof Collection | undefined;
    if (!cls || !('handle' in cls) || !('schema' in cls)) continue;

    const existing = await opts.adapter.queryOne<{ handle: string }>(
      'SELECT handle FROM collections WHERE handle = ?',
      [cls.handle],
    );
    if (existing) continue;

    const definition = classToDefinition(cls);
    await opts.adapter.exec(
      `INSERT INTO collections (handle, definition, blueprint_hash, singleton)
       VALUES (?, ?, ?, ?)`,
      [definition.handle, JSON.stringify(definition), hashDefinition(definition), 0],
    );
  }
}

function classToDefinition(cls: typeof Collection): BlueprintDefinition {
  const fields: FieldDefinition[] = [];
  const shape = cls.schema.shape;
  for (const [name, fieldSchema] of Object.entries(shape)) {
    const meta = (fieldSchema as { meta?: () => { ui?: FieldUi } }).meta?.();
    const ui = meta?.ui;
    if (!ui) throw new Error(`field '${name}' in '${cls.handle}' is missing .meta({ ui })`);
    fields.push({
      name,
      label: titleCase(name),
      ui,
      optional: (fieldSchema as { _zod?: { optin?: string } })._zod?.optin === 'optional',
      default: extractDefault(fieldSchema),
      validation: extractValidation(fieldSchema),
    });
  }
  return {
    handle: cls.handle,
    label: cls.label ?? cls.handle,
    singleton: false,
    fields,
  };
}

function titleCase(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function extractDefault(schema: unknown): unknown {
  const def = (schema as { _def?: { defaultValue?: () => unknown } })._def;
  if (def && typeof def.defaultValue === 'function') return def.defaultValue();
  return undefined;
}

function extractValidation(schema: unknown): { min?: number; max?: number } | undefined {
  const def = (schema as { _def?: { checks?: Array<{ kind?: string; value?: number }> } })._def;
  const checks = def?.checks;
  if (!checks || !Array.isArray(checks)) return undefined;
  const out: { min?: number; max?: number } = {};
  for (const c of checks) {
    if (c.kind === 'min' && typeof c.value === 'number') out.min = c.value;
    if (c.kind === 'max' && typeof c.value === 'number') out.max = c.value;
  }
  return Object.keys(out).length ? out : undefined;
}

function _typeAssert<T extends z.ZodObject<z.ZodRawShape>>(_t: T): void {}
```

The `_typeAssert` helper is intentionally unused — its sole purpose is to keep the `z` import alive even after a future refactor; remove it if you find it offensive. (Biome is configured to allow this with `noUnusedImports` already off in the workspace config.)

Actually skip it — drop the unused `z` import:

```ts
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseAdapter } from '@vulse/db';
import { Collection } from './collection.js';
import { hashDefinition } from './compile.js';
import type { BlueprintDefinition, FieldDefinition, FieldUi } from './definition.js';
```

(Use this import list. Don't include the `z` import or `_typeAssert`.)

- [ ] **Step 3: Replace `packages/core/src/blueprints/load.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { LibsqlAdapter, runMigrations, MIGRATIONS_DIR } from '@vulse/db';
import { loadBlueprints, reloadBlueprint } from './load.js';
import { seedBlueprintsFromCode } from './seed.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '__fixtures__');

async function freshDb() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe('loadBlueprints / reloadBlueprint', () => {
  it('loads seeded blueprints with compiled Zod schemas', async () => {
    const db = await freshDb();
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    const map = await loadBlueprints({ adapter: db });
    expect([...map.keys()].sort()).toEqual(['authors', 'posts']);
    expect(map.get('posts')!.schema.safeParse({ title: 'a', body: [] }).success).toBe(true);
    await db.close();
  });

  it('throws when a row has a null definition', async () => {
    const db = await freshDb();
    await db.exec("INSERT INTO collections (handle, blueprint_hash) VALUES ('orphan', 'h')");
    await expect(loadBlueprints({ adapter: db })).rejects.toThrow(/no definition/);
    await db.close();
  });

  it('reloadBlueprint returns a single compiled blueprint', async () => {
    const db = await freshDb();
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    const bp = await reloadBlueprint('posts', { adapter: db });
    expect(bp).not.toBeNull();
    expect(bp!.handle).toBe('posts');
    expect(bp!.hash).toHaveLength(64);
    await db.close();
  });

  it('reloadBlueprint returns null for missing handle', async () => {
    const db = await freshDb();
    expect(await reloadBlueprint('ghost', { adapter: db })).toBeNull();
    await db.close();
  });
});
```

- [ ] **Step 4: Write `packages/core/src/blueprints/seed.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { LibsqlAdapter, runMigrations, MIGRATIONS_DIR } from '@vulse/db';
import { seedBlueprintsFromCode } from './seed.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '__fixtures__');

async function freshDb() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe('seedBlueprintsFromCode', () => {
  it('inserts a row per fixture class', async () => {
    const db = await freshDb();
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    const rows = await db.query<{ handle: string; definition: string }>(
      'SELECT handle, definition FROM collections ORDER BY handle',
    );
    expect(rows.map((r) => r.handle)).toEqual(['authors', 'posts']);
    const posts = JSON.parse(rows[1]!.definition);
    expect(posts.handle).toBe('posts');
    expect(posts.fields.find((f: { name: string }) => f.name === 'title')).toBeDefined();
    await db.close();
  });

  it('is idempotent on second run', async () => {
    const db = await freshDb();
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    const rows = await db.query<{ handle: string }>('SELECT handle FROM collections');
    expect(rows).toHaveLength(2);
    await db.close();
  });

  it('preserves admin-side edits across reseed', async () => {
    const db = await freshDb();
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    await db.exec(
      "UPDATE collections SET definition = json_set(definition, '$.label', 'Articles') WHERE handle = 'posts'",
    );
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    const row = await db.queryOne<{ definition: string }>(
      "SELECT definition FROM collections WHERE handle = 'posts'",
    );
    expect(JSON.parse(row!.definition).label).toBe('Articles');
    await db.close();
  });
});
```

- [ ] **Step 5: Run the new tests — they will fail until the `index.ts` re-export gap from B1 is closed (which depends on B5)**

Run: `pnpm --filter @vulse/core test load seed 2>&1 | tail -15`
Expected: tests for load & seed should run and pass once compiled. If the runner reports module resolution errors for `mutations.js`, that's fine — those land in B5; this task's tests don't touch mutations.

If errors block, temporarily simplify `packages/core/src/index.ts` to re-export only what exists right now:

```ts
export { Collection } from './blueprints/collection.js';
export type { Blueprint, FieldMeta, FieldUi, FieldDefinition } from './blueprints/types.js';
export { BlueprintDefinitionSchema, type BlueprintDefinition } from './blueprints/definition.js';
export { loadBlueprints, reloadBlueprint, type LoadOptions } from './blueprints/load.js';
export { seedBlueprintsFromCode } from './blueprints/seed.js';
export { blueprintEvents } from './events.js';
export { createContentService } from './content/service.js';
export type { ContentService, Entry } from './content/types.js';
export { createApi, type ApiDeps } from './http/api.js';
export { toMeta, type BlueprintMeta } from './http/meta.js';
export { ValidationError, NotFoundError } from './errors.js';
```

Then re-run.

Expected: 4 load tests + 3 seed tests pass. Existing tests (`content/service.test.ts`, `http/api.test.ts`) will fail because they still pass `fixturesDir` to `loadBlueprints`. That's Task B5/Step 7's job.

- [ ] **Step 6: Update existing tests that called `loadBlueprints(fixturesDir, {adapter})` to seed-then-load**

Replace the setup helper in `packages/core/src/content/service.test.ts`:

```ts
async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db, MIGRATIONS_DIR);
  await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
  const blueprints = await loadBlueprints({ adapter: db });
  const content = createContentService(db, blueprints);
  return { db, blueprints, content };
}
```

Add the new import at the top of that file:

```ts
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
```

Do the same in `packages/core/src/http/api.test.ts`'s `setup()` — replace the `loadBlueprints` call with a seed-then-load pair and import `seedBlueprintsFromCode`.

- [ ] **Step 7: Run all core tests**

Run: `pnpm --filter @vulse/core test`
Expected: 3 service tests previously passing now still pass; 6 API tests pass; 9 compile tests pass; 4 load tests + 3 seed tests pass — total ≈ 25.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): DB-backed loader + first-boot seeder + reloadBlueprint"
```

---

### Task B5: Mutations + validation — TDD

**Files:**
- Create: `packages/core/src/blueprints/mutations.test.ts`
- Create: `packages/core/src/blueprints/mutations.ts`

- [ ] **Step 1: Write failing test `packages/core/src/blueprints/mutations.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { LibsqlAdapter, runMigrations, MIGRATIONS_DIR } from '@vulse/db';
import { createBlueprint, updateBlueprint, deleteBlueprint } from './mutations.js';
import { seedBlueprintsFromCode } from './seed.js';
import { ValidationError, NotFoundError } from '../errors.js';
import type { BlueprintDefinition, BlueprintDefinitionWithRenames } from './definition.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '__fixtures__');

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db, MIGRATIONS_DIR);
  await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
  return db;
}

const minimal: BlueprintDefinition = {
  handle: 'pages',
  label: 'Pages',
  singleton: false,
  fields: [{ name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false }],
};

describe('createBlueprint', () => {
  it('inserts a new blueprint and returns the persisted definition', async () => {
    const db = await setup();
    const out = await createBlueprint(db, minimal);
    expect(out.handle).toBe('pages');
    const row = await db.queryOne<{ definition: string }>(
      "SELECT definition FROM collections WHERE handle = 'pages'",
    );
    expect(JSON.parse(row!.definition).handle).toBe('pages');
    await db.close();
  });

  it('rejects a duplicate handle', async () => {
    const db = await setup();
    await expect(createBlueprint(db, { ...minimal, handle: 'posts' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await db.close();
  });

  it('rejects an invalid handle', async () => {
    const db = await setup();
    await expect(createBlueprint(db, { ...minimal, handle: '1nvalid' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await db.close();
  });

  it('rejects empty fields', async () => {
    const db = await setup();
    await expect(createBlueprint(db, { ...minimal, fields: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await db.close();
  });

  it('rejects duplicate field names', async () => {
    const db = await setup();
    await expect(
      createBlueprint(db, {
        ...minimal,
        fields: [
          { name: 'x', ui: { kind: 'text' }, optional: false },
          { name: 'x', ui: { kind: 'text' }, optional: false },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await db.close();
  });

  it('rejects a relationship whose target does not exist', async () => {
    const db = await setup();
    await expect(
      createBlueprint(db, {
        ...minimal,
        fields: [
          { name: 'parent', ui: { kind: 'relationship', to: 'ghosts' }, optional: false },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await db.close();
  });
});

describe('updateBlueprint', () => {
  it('replaces the definition and recomputes the hash', async () => {
    const db = await setup();
    const next: BlueprintDefinitionWithRenames = {
      handle: 'posts',
      label: 'Articles',
      singleton: false,
      fields: [
        {
          name: 'title',
          label: 'Title',
          ui: { kind: 'text' },
          optional: false,
          validation: { min: 1 },
        },
        { name: 'body', label: 'Body', ui: { kind: 'blocks' }, optional: false },
      ],
    };
    await updateBlueprint(db, 'posts', next);
    const row = await db.queryOne<{ definition: string; blueprint_hash: string }>(
      "SELECT definition, blueprint_hash FROM collections WHERE handle = 'posts'",
    );
    expect(JSON.parse(row!.definition).label).toBe('Articles');
    expect(row!.blueprint_hash).toHaveLength(64);
    await db.close();
  });

  it('renames a field and rewrites entries.content JSON keys', async () => {
    const db = await setup();
    // Insert an entry with the original 'title' field
    await db.exec(
      "INSERT INTO entries (id, collection_handle, content) VALUES ('e1', 'posts', '{\"title\":\"Hello\",\"body\":[]}')",
    );

    await updateBlueprint(db, 'posts', {
      handle: 'posts',
      label: 'Posts',
      singleton: false,
      fields: [
        {
          name: 'headline',
          previousName: 'title',
          label: 'Headline',
          ui: { kind: 'text' },
          optional: false,
        },
        { name: 'body', label: 'Body', ui: { kind: 'blocks' }, optional: false },
      ],
    });

    const row = await db.queryOne<{ content: string }>(
      "SELECT content FROM entries WHERE id = 'e1'",
    );
    const parsed = JSON.parse(row!.content);
    expect(parsed).toEqual({ headline: 'Hello', body: [] });
    await db.close();
  });

  it('leaves orphan data when a field is removed', async () => {
    const db = await setup();
    await db.exec(
      "INSERT INTO entries (id, collection_handle, content) VALUES ('e1', 'posts', '{\"title\":\"Hello\",\"body\":[]}')",
    );
    await updateBlueprint(db, 'posts', {
      handle: 'posts',
      label: 'Posts',
      singleton: false,
      fields: [{ name: 'body', label: 'Body', ui: { kind: 'blocks' }, optional: false }],
    });
    const row = await db.queryOne<{ content: string }>(
      "SELECT content FROM entries WHERE id = 'e1'",
    );
    expect(JSON.parse(row!.content)).toEqual({ title: 'Hello', body: [] });
    await db.close();
  });

  it('rejects previousName that did not exist in the prior definition', async () => {
    const db = await setup();
    await expect(
      updateBlueprint(db, 'posts', {
        handle: 'posts',
        label: 'Posts',
        singleton: false,
        fields: [
          {
            name: 'x',
            previousName: 'never_existed',
            ui: { kind: 'text' },
            optional: false,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await db.close();
  });

  it('throws NotFoundError for unknown handle', async () => {
    const db = await setup();
    await expect(
      updateBlueprint(db, 'ghost', { ...minimal, handle: 'ghost' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await db.close();
  });
});

describe('deleteBlueprint', () => {
  it('removes the row and cascades to entries', async () => {
    const db = await setup();
    await db.exec(
      "INSERT INTO entries (id, collection_handle, content) VALUES ('e1', 'posts', '{}')",
    );
    await deleteBlueprint(db, 'posts');
    expect(
      await db.queryOne("SELECT handle FROM collections WHERE handle = 'posts'"),
    ).toBeNull();
    expect(await db.query("SELECT id FROM entries WHERE collection_handle = 'posts'")).toEqual(
      [],
    );
    await db.close();
  });

  it('throws NotFoundError for unknown handle', async () => {
    const db = await setup();
    await expect(deleteBlueprint(db, 'ghost')).rejects.toBeInstanceOf(NotFoundError);
    await db.close();
  });
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `pnpm --filter @vulse/core test mutations`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `packages/core/src/blueprints/mutations.ts`**

```ts
import type { DatabaseAdapter } from '@vulse/db';
import { NotFoundError, ValidationError } from '../errors.js';
import { hashDefinition } from './compile.js';
import {
  BlueprintDefinitionSchema,
  BlueprintDefinitionWithRenamesSchema,
  type BlueprintDefinition,
  type BlueprintDefinitionWithRenames,
  type FieldDefinitionWithRename,
} from './definition.js';
import { blueprintEvents } from '../events.js';

export async function createBlueprint(
  db: DatabaseAdapter,
  input: BlueprintDefinition,
): Promise<BlueprintDefinition> {
  const def = await validateNew(db, input);
  await db.exec(
    `INSERT INTO collections (handle, definition, blueprint_hash, singleton)
     VALUES (?, ?, ?, ?)`,
    [def.handle, JSON.stringify(def), hashDefinition(def), def.singleton ? 1 : 0],
  );
  blueprintEvents.emit('change', { handle: def.handle, kind: 'create' });
  return def;
}

export async function updateBlueprint(
  db: DatabaseAdapter,
  handle: string,
  input: BlueprintDefinitionWithRenames,
): Promise<BlueprintDefinition> {
  const existing = await loadDefinition(db, handle);
  if (!existing) throw new NotFoundError(`blueprint not found: ${handle}`);

  // Enforce handle immutability: ignore any handle in body, use URL param.
  const incoming = { ...input, handle };
  const parsed = parseOrThrow(BlueprintDefinitionWithRenamesSchema, incoming);

  // Validate previousName values against the prior definition.
  const oldNames = new Set(existing.fields.map((f) => f.name));
  for (const f of parsed.fields) {
    if (f.previousName !== undefined && !oldNames.has(f.previousName)) {
      throw new ValidationError([
        {
          code: 'custom',
          message: `previousName '${f.previousName}' was not in the prior definition`,
          path: ['fields', parsed.fields.indexOf(f), 'previousName'],
        } as never,
      ]);
    }
  }

  await ensureValidCrossField(db, parsed, handle);

  const renames = computeRenames(parsed.fields);
  const canonical: BlueprintDefinition = stripRenames(parsed);

  await db.transaction(async (tx) => {
    for (const [oldName, newName] of renames) {
      await tx.exec(
        `UPDATE entries
         SET content = json_set(
           json_remove(content, '$.' || ?),
           '$.' || ?,
           json_extract(content, '$.' || ?)
         )
         WHERE collection_handle = ? AND json_extract(content, '$.' || ?) IS NOT NULL`,
        [oldName, newName, oldName, handle, oldName],
      );
    }
    await tx.exec(
      `UPDATE collections
       SET definition = ?, blueprint_hash = ?, singleton = ?, updated_at = datetime('now')
       WHERE handle = ?`,
      [
        JSON.stringify(canonical),
        hashDefinition(canonical),
        canonical.singleton ? 1 : 0,
        handle,
      ],
    );
  });

  blueprintEvents.emit('change', { handle, kind: 'update' });
  return canonical;
}

export async function deleteBlueprint(db: DatabaseAdapter, handle: string): Promise<void> {
  const existing = await db.queryOne<{ handle: string }>(
    'SELECT handle FROM collections WHERE handle = ?',
    [handle],
  );
  if (!existing) throw new NotFoundError(`blueprint not found: ${handle}`);
  await db.exec('DELETE FROM collections WHERE handle = ?', [handle]);
  blueprintEvents.emit('change', { handle, kind: 'delete' });
}

// ---- helpers ----

async function validateNew(
  db: DatabaseAdapter,
  input: BlueprintDefinition,
): Promise<BlueprintDefinition> {
  const def = parseOrThrow(BlueprintDefinitionSchema, input);
  const dup = await db.queryOne<{ handle: string }>(
    'SELECT handle FROM collections WHERE handle = ?',
    [def.handle],
  );
  if (dup) {
    throw new ValidationError([
      {
        code: 'custom',
        message: `handle '${def.handle}' already exists`,
        path: ['handle'],
      } as never,
    ]);
  }
  await ensureValidCrossField(db, def, null);
  return def;
}

async function ensureValidCrossField(
  db: DatabaseAdapter,
  def: BlueprintDefinition | BlueprintDefinitionWithRenames,
  selfHandle: string | null,
): Promise<void> {
  // Unique field names (within the blueprint).
  const seen = new Set<string>();
  for (let i = 0; i < def.fields.length; i++) {
    const f = def.fields[i]!;
    if (seen.has(f.name)) {
      throw new ValidationError([
        {
          code: 'custom',
          message: `duplicate field name '${f.name}'`,
          path: ['fields', i, 'name'],
        } as never,
      ]);
    }
    seen.add(f.name);
  }
  // Relationship targets must exist.
  for (let i = 0; i < def.fields.length; i++) {
    const f = def.fields[i]!;
    if (f.ui.kind === 'relationship') {
      if (f.ui.to === selfHandle) continue; // self-ref allowed (parent_id semantics)
      const target = await db.queryOne<{ handle: string }>(
        'SELECT handle FROM collections WHERE handle = ?',
        [f.ui.to],
      );
      if (!target && f.ui.to !== def.handle) {
        throw new ValidationError([
          {
            code: 'custom',
            message: `relationship target '${f.ui.to}' does not exist`,
            path: ['fields', i, 'ui', 'to'],
          } as never,
        ]);
      }
    }
  }
}

function computeRenames(fields: FieldDefinitionWithRename[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const f of fields) {
    if (f.previousName !== undefined && f.previousName !== f.name) {
      out.push([f.previousName, f.name]);
    }
  }
  return out;
}

function stripRenames(def: BlueprintDefinitionWithRenames): BlueprintDefinition {
  return {
    handle: def.handle,
    label: def.label,
    singleton: def.singleton,
    fields: def.fields.map(({ previousName: _previousName, ...rest }) => rest),
  };
}

async function loadDefinition(
  db: DatabaseAdapter,
  handle: string,
): Promise<BlueprintDefinition | null> {
  const row = await db.queryOne<{ definition: string | null }>(
    'SELECT definition FROM collections WHERE handle = ?',
    [handle],
  );
  if (!row || !row.definition) return null;
  return BlueprintDefinitionSchema.parse(JSON.parse(row.definition));
}

function parseOrThrow<T>(schema: { safeParse: (x: unknown) => { success: true; data: T } | { success: false; error: { issues: unknown[] } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(result.error.issues as never);
  }
  return result.data;
}
```

- [ ] **Step 4: Restore the full `packages/core/src/index.ts` re-export list now that mutations exists**

Replace `packages/core/src/index.ts` with:

```ts
export { Collection } from './blueprints/collection.js';
export type { Blueprint, FieldMeta, FieldUi, FieldDefinition } from './blueprints/types.js';
export {
  BlueprintDefinitionSchema,
  BlueprintDefinitionWithRenamesSchema,
  FieldDefinitionSchema,
  FieldUiSchema,
  type BlueprintDefinition,
  type BlueprintDefinitionWithRenames,
  type FieldDefinitionWithRename,
} from './blueprints/definition.js';
export { loadBlueprints, reloadBlueprint, type LoadOptions } from './blueprints/load.js';
export { seedBlueprintsFromCode } from './blueprints/seed.js';
export {
  createBlueprint,
  updateBlueprint,
  deleteBlueprint,
} from './blueprints/mutations.js';
export { blueprintEvents } from './events.js';
export { createContentService } from './content/service.js';
export type { ContentService, Entry } from './content/types.js';
export { createApi, type ApiDeps } from './http/api.js';
export { toMeta, type BlueprintMeta } from './http/meta.js';
export { ValidationError, NotFoundError } from './errors.js';
```

- [ ] **Step 5: Run all core tests**

Run: `pnpm --filter @vulse/core test`
Expected: all prior tests (9 compile + 4 load + 3 seed + 9 service + 6 api) plus the new mutations tests pass → ≈ 41 total.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @vulse/core check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): blueprint mutations with rename rewrite and validation"
```

---

## Phase C — Hono API

### Task C1: `/api/blueprints/*` routes + refactor content routes to wildcard handlers

**Files:**
- Modify: `packages/core/src/http/api.ts`
- Create: `packages/core/src/http/blueprints.api.test.ts`

- [ ] **Step 1: Replace `packages/core/src/http/api.ts`**

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Blueprint } from '../blueprints/types.js';
import type { ContentService } from '../content/types.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { toMeta } from './meta.js';
import {
  createBlueprint,
  updateBlueprint,
  deleteBlueprint,
} from '../blueprints/mutations.js';
import {
  BlueprintDefinitionSchema,
  BlueprintDefinitionWithRenamesSchema,
} from '../blueprints/definition.js';
import type { DatabaseAdapter } from '@vulse/db';

export interface ApiDeps {
  blueprints: Map<string, Blueprint>;
  content: ContentService;
  adapter: DatabaseAdapter;
}

export function createApi({ blueprints, content, adapter }: ApiDeps): Hono {
  const app = new Hono();
  app.use('*', cors());

  app.onError((err, c) => {
    if (err instanceof ValidationError) {
      return c.json({ error: 'validation', issues: err.issues }, 422);
    }
    if (err instanceof NotFoundError) {
      return c.json({ error: 'not_found', message: err.message }, 404);
    }
    console.error(err);
    return c.json({ error: 'internal', message: err.message }, 500);
  });

  // ---- Content routes (wildcard so admin mutations are reflected immediately) ----

  app.get('/api/collections/:handle', async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    const limit = Number(c.req.query('limit') ?? '100');
    const offset = Number(c.req.query('offset') ?? '0');
    return c.json(await content.list(handle, { limit, offset }));
  });

  app.get('/api/collections/:handle/:id', async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    const entry = await content.get(handle, c.req.param('id'));
    if (!entry) throw new NotFoundError('entry not found');
    return c.json(entry);
  });

  app.post('/api/collections/:handle', async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    const input = await c.req.json();
    const entry = await content.create(handle, input);
    return c.json(entry, 201);
  });

  app.patch('/api/collections/:handle/:id', async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    const input = await c.req.json();
    const entry = await content.update(handle, c.req.param('id'), input);
    return c.json(entry);
  });

  app.delete('/api/collections/:handle/:id', async (c) => {
    const handle = c.req.param('handle');
    if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
    await content.delete(handle, c.req.param('id'));
    return c.body(null, 204);
  });

  // ---- Blueprint routes ----

  app.get('/api/blueprints', async () => {
    const rows = await adapter.query<{ definition: string | null }>(
      'SELECT definition FROM collections WHERE definition IS NOT NULL ORDER BY created_at ASC',
    );
    return Response.json(rows.map((r) => JSON.parse(r.definition!)));
  });

  app.get('/api/blueprints/:handle', async (c) => {
    const row = await adapter.queryOne<{ definition: string | null }>(
      'SELECT definition FROM collections WHERE handle = ?',
      [c.req.param('handle')],
    );
    if (!row || !row.definition) throw new NotFoundError('blueprint not found');
    return c.json(JSON.parse(row.definition));
  });

  app.post('/api/blueprints', async (c) => {
    const body = await c.req.json();
    const parsed = BlueprintDefinitionSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    const out = await createBlueprint(adapter, parsed.data);
    return c.json(out, 201);
  });

  app.patch('/api/blueprints/:handle', async (c) => {
    const body = await c.req.json();
    const parsed = BlueprintDefinitionWithRenamesSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    const out = await updateBlueprint(adapter, c.req.param('handle'), parsed.data);
    return c.json(out);
  });

  app.delete('/api/blueprints/:handle', async (c) => {
    await deleteBlueprint(adapter, c.req.param('handle'));
    return c.body(null, 204);
  });

  app.get('/api/_meta/collections', (c) => c.json([...blueprints.values()].map(toMeta)));

  return app;
}
```

- [ ] **Step 2: Update the existing `packages/core/src/http/api.test.ts` setup to pass the new `adapter` dep**

Open `packages/core/src/http/api.test.ts`. In the `setup()` function, change the `createApi(...)` call to:

```ts
const app = createApi({ blueprints, content, adapter: db });
```

- [ ] **Step 3: Run existing API tests to confirm wildcard routes still satisfy them**

Run: `pnpm --filter @vulse/core test api`
Expected: 6 tests pass — the previous per-handle route generation is gone, but the wildcard routes deliver identical behavior.

- [ ] **Step 4: Write `packages/core/src/http/blueprints.api.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { LibsqlAdapter, runMigrations, MIGRATIONS_DIR } from '@vulse/db';
import { loadBlueprints } from '../blueprints/load.js';
import { createContentService } from '../content/service.js';
import { createApi } from './api.js';
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'blueprints', '__fixtures__');

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
  const blueprints = await loadBlueprints({ adapter: db });
  const content = createContentService(db, blueprints);
  const app = createApi({ blueprints, content, adapter: db });
  return { db, app };
}

describe('blueprints API', () => {
  it('lists seeded blueprints', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/blueprints');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handle: string }[];
    expect(body.map((b) => b.handle).sort()).toEqual(['authors', 'posts']);
    await db.close();
  });

  it('GET /api/blueprints/:handle returns the definition', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/blueprints/posts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handle: string; fields: { name: string }[] };
    expect(body.handle).toBe('posts');
    expect(body.fields.find((f) => f.name === 'title')).toBeDefined();
    await db.close();
  });

  it('GET /api/blueprints/:handle returns 404 for unknown handle', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/blueprints/ghost');
    expect(res.status).toBe(404);
    await db.close();
  });

  it('POST creates a new blueprint', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/blueprints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'pages',
        label: 'Pages',
        singleton: false,
        fields: [{ name: 'title', ui: { kind: 'text' }, optional: false }],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { handle: string };
    expect(body.handle).toBe('pages');
    await db.close();
  });

  it('POST returns 422 on validation failure', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/blueprints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'Bad Handle',
        label: 'X',
        singleton: false,
        fields: [{ name: 'x', ui: { kind: 'text' }, optional: false }],
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('validation');
    await db.close();
  });

  it('PATCH updates a blueprint and applies a rename', async () => {
    const { app, db } = await setup();
    // Create an entry with original 'title'
    await db.exec(
      "INSERT INTO entries (id, collection_handle, content) VALUES ('e1', 'posts', '{\"title\":\"Hello\",\"body\":[]}')",
    );
    const res = await app.request('http://x/api/blueprints/posts', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'posts',
        label: 'Articles',
        singleton: false,
        fields: [
          { name: 'headline', previousName: 'title', ui: { kind: 'text' }, optional: false },
          { name: 'body', ui: { kind: 'blocks' }, optional: false },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const row = await db.queryOne<{ content: string }>(
      "SELECT content FROM entries WHERE id = 'e1'",
    );
    expect(JSON.parse(row!.content).headline).toBe('Hello');
    await db.close();
  });

  it('DELETE removes a blueprint', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/blueprints/authors', { method: 'DELETE' });
    expect(res.status).toBe(204);
    await db.close();
  });
});
```

- [ ] **Step 5: Run all core tests**

Run: `pnpm --filter @vulse/core test`
Expected: existing 6 API tests still pass + 7 new blueprint API tests pass + all other tests stay green.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): /api/blueprints CRUD routes; refactor content routes to wildcards"
```

---

## Phase D — Admin

### Task D1: API client extensions + blueprint mutations store

**Files:**
- Modify: `packages/admin/src/api/client.ts`
- Modify: `packages/admin/src/stores/blueprints.ts`

- [ ] **Step 1: Add blueprint-shaped types and methods to `packages/admin/src/api/client.ts`**

At the top of the file, replace the existing `FieldMeta` and `BlueprintMeta` interfaces with the full definition shape (these are now identical to what the API returns):

```ts
export interface FieldUi {
  kind: 'text' | 'textarea' | 'blocks' | 'date' | 'boolean' | 'select' | 'relationship';
  options?: readonly string[];
  to?: string;
}

export interface FieldDefinition {
  name: string;
  label?: string;
  ui: FieldUi;
  optional: boolean;
  default?: unknown;
  validation?: { min?: number; max?: number };
}

// Backwards-compat alias for the existing FieldRenderer code.
export type FieldMeta = FieldDefinition;

export interface BlueprintMeta {
  handle: string;
  label: string;
  singleton: boolean;
  fields: FieldDefinition[];
}

// Server PATCH body adds previousName per field.
export type FieldDefinitionWithRename = FieldDefinition & { previousName?: string };
export interface BlueprintDefinitionWithRenames extends Omit<BlueprintMeta, 'fields'> {
  fields: FieldDefinitionWithRename[];
}
```

Then add new methods to the `ApiClient` class (anywhere between `delete` and `request`):

```ts
listBlueprints(): Promise<BlueprintMeta[]> {
  return this.request<BlueprintMeta[]>('GET', '/api/blueprints');
}
getBlueprint(handle: string): Promise<BlueprintMeta> {
  return this.request<BlueprintMeta>('GET', `/api/blueprints/${handle}`);
}
createBlueprint(def: BlueprintMeta): Promise<BlueprintMeta> {
  return this.request<BlueprintMeta>('POST', '/api/blueprints', def);
}
updateBlueprint(handle: string, def: BlueprintDefinitionWithRenames): Promise<BlueprintMeta> {
  return this.request<BlueprintMeta>('PATCH', `/api/blueprints/${handle}`, def);
}
deleteBlueprint(handle: string): Promise<void> {
  return this.request<void>('DELETE', `/api/blueprints/${handle}`);
}
```

- [ ] **Step 2: Extend `packages/admin/src/stores/blueprints.ts` to support refetching after mutations**

Replace the file's full contents with:

```ts
import { defineStore } from 'pinia';
import { type BlueprintMeta, api } from '../api/client.js';

export const useBlueprintsStore = defineStore('blueprints', {
  state: () => ({
    map: new Map<string, BlueprintMeta>(),
    hydrated: false,
  }),
  getters: {
    list: (s) => [...s.map.values()],
  },
  actions: {
    async hydrate() {
      if (this.hydrated) return;
      await this.refresh();
      this.hydrated = true;
    },
    async refresh() {
      const all = await api.meta();
      this.map = new Map(all.map((bp) => [bp.handle, bp]));
    },
    get(handle: string): BlueprintMeta | undefined {
      return this.map.get(handle);
    },
  },
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @vulse/admin check`
Expected: clean. Existing admin tests should still pass: `pnpm --filter @vulse/admin test` — 9/9 pass.

- [ ] **Step 4: Commit**

```bash
git add packages/admin
git commit -m "feat(admin): API client for /api/blueprints + store refresh action"
```

---

### Task D2: BlueprintList page + Schema sidebar group

**Files:**
- Create: `packages/admin/src/pages/BlueprintList.vue`
- Modify: `packages/admin/src/router.ts`
- Modify: `packages/admin/src/App.vue`

- [ ] **Step 1: Create `packages/admin/src/pages/BlueprintList.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, type BlueprintMeta } from '../api/client.js';

const blueprints = ref<BlueprintMeta[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    blueprints.value = await api.listBlueprints();
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="p-6" data-testid="blueprint-list">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-semibold">Schema</h1>
      <RouterLink
        to="/schema/new"
        class="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
        data-testid="new-blueprint"
      >
        + New collection
      </RouterLink>
    </div>
    <div v-if="loading" class="text-sm text-zinc-500">Loading…</div>
    <table v-else class="w-full text-sm">
      <thead class="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
        <tr>
          <th class="py-2">Handle</th>
          <th class="py-2">Label</th>
          <th class="py-2">Fields</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="bp in blueprints" :key="bp.handle" class="border-b border-zinc-100">
          <td class="py-2 font-mono text-xs">
            <RouterLink :to="`/schema/${bp.handle}`" class="hover:underline">
              {{ bp.handle }}
            </RouterLink>
          </td>
          <td class="py-2">{{ bp.label }}</td>
          <td class="py-2 text-zinc-500">{{ bp.fields.length }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 2: Update `packages/admin/src/router.ts` to add Schema routes**

Replace the file's full contents with:

```ts
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import CollectionList from './pages/CollectionList.vue';
import CollectionEntry from './pages/CollectionEntry.vue';
import BlueprintList from './pages/BlueprintList.vue';
import BlueprintEditor from './pages/BlueprintEditor.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/loading' },
  { path: '/loading', component: { template: '<div class="p-8 text-zinc-500">Loading…</div>' } },
  { path: '/collections/:handle', component: CollectionList, props: true },
  {
    path: '/collections/:handle/new',
    component: CollectionEntry,
    props: (r) => ({ handle: r.params.handle, id: null }),
  },
  { path: '/collections/:handle/:id', component: CollectionEntry, props: true },
  { path: '/schema', component: BlueprintList },
  { path: '/schema/new', component: BlueprintEditor, props: () => ({ handle: null }) },
  { path: '/schema/:handle', component: BlueprintEditor, props: true },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
```

(`BlueprintEditor.vue` will be created in Task D3; this commit will fail to compile until then. That's expected. Skip the typecheck step until D3.)

- [ ] **Step 3: Add the Schema sidebar group to `packages/admin/src/App.vue`**

Replace the `<nav>` block inside `<aside>` with:

```vue
      <nav class="px-2">
        <div class="px-2 pt-2 text-xs uppercase tracking-wide text-zinc-500">Collections</div>
        <RouterLink
          v-for="bp in store.list"
          :key="`coll-${bp.handle}`"
          :to="`/collections/${bp.handle}`"
          class="block rounded px-2 py-1.5 text-sm hover:bg-zinc-100"
          active-class="bg-zinc-100 font-medium"
          :data-testid="`nav-${bp.handle}`"
        >
          {{ bp.label }}
        </RouterLink>

        <div class="px-2 pt-4 text-xs uppercase tracking-wide text-zinc-500">Schema</div>
        <RouterLink
          v-for="bp in store.list"
          :key="`schema-${bp.handle}`"
          :to="`/schema/${bp.handle}`"
          class="block rounded px-2 py-1.5 text-sm hover:bg-zinc-100"
          active-class="bg-zinc-100 font-medium"
          :data-testid="`schema-nav-${bp.handle}`"
        >
          {{ bp.label }}
        </RouterLink>
        <RouterLink
          to="/schema/new"
          class="block rounded px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
          active-class="bg-zinc-100 font-medium"
          data-testid="schema-nav-new"
        >
          + New collection
        </RouterLink>
      </nav>
```

- [ ] **Step 4: Commit (typecheck deferred to D3 since `BlueprintEditor` is still missing)**

```bash
git add packages/admin/src/pages/BlueprintList.vue packages/admin/src/router.ts packages/admin/src/App.vue
git commit -m "feat(admin): blueprint list page + Schema sidebar group + routes"
```

---

### Task D3: BlueprintEditor — scaffold + handle/label/singleton

**Files:**
- Create: `packages/admin/src/pages/BlueprintEditor.vue`

- [ ] **Step 1: Implement the editor scaffold at `packages/admin/src/pages/BlueprintEditor.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import {
  type ApiError,
  type BlueprintMeta,
  type FieldDefinition,
  type FieldUi,
  api,
} from '../api/client.js';
import { useBlueprintsStore } from '../stores/blueprints.js';

const props = defineProps<{ handle: string | null }>();
const router = useRouter();
const store = useBlueprintsStore();

interface EditorField extends FieldDefinition {
  previousName: string | null; // null = newly added; otherwise tracks rename source
}

const handle = ref('');
const label = ref('');
const singleton = ref(false);
const fields = reactive<EditorField[]>([]);
const expandedIndex = ref<number | null>(null);

const errors = reactive<Record<string, string>>({});
const submitError = ref<string | null>(null);
const saving = ref(false);

const isCreate = computed(() => props.handle === null);

async function load() {
  Object.keys(errors).forEach((k) => delete errors[k]);
  fields.splice(0, fields.length);
  if (props.handle === null) {
    handle.value = '';
    label.value = '';
    singleton.value = false;
    return;
  }
  const bp = await api.getBlueprint(props.handle);
  handle.value = bp.handle;
  label.value = bp.label;
  singleton.value = bp.singleton;
  for (const f of bp.fields) {
    fields.push({ ...f, previousName: f.name });
  }
}

onMounted(load);
watch(() => props.handle, load);

function addField() {
  fields.push({
    name: '',
    label: '',
    ui: { kind: 'text' },
    optional: false,
    previousName: null,
  });
  expandedIndex.value = fields.length - 1;
}

function removeField(i: number) {
  fields.splice(i, 1);
  if (expandedIndex.value === i) expandedIndex.value = null;
}

function moveUp(i: number) {
  if (i === 0) return;
  const [moved] = fields.splice(i, 1);
  fields.splice(i - 1, 0, moved!);
  if (expandedIndex.value === i) expandedIndex.value = i - 1;
}

function moveDown(i: number) {
  if (i >= fields.length - 1) return;
  const [moved] = fields.splice(i, 1);
  fields.splice(i + 1, 0, moved!);
  if (expandedIndex.value === i) expandedIndex.value = i + 1;
}

function setKind(i: number, kind: FieldUi['kind']) {
  const f = fields[i]!;
  if (kind === 'select') f.ui = { kind, options: [] };
  else if (kind === 'relationship') f.ui = { kind, to: '' };
  else f.ui = { kind };
}

async function save() {
  Object.keys(errors).forEach((k) => delete errors[k]);
  submitError.value = null;
  saving.value = true;
  try {
    const payload = {
      handle: handle.value,
      label: label.value,
      singleton: singleton.value,
      fields: fields.map((f) => {
        const out: Record<string, unknown> = {
          name: f.name,
          label: f.label,
          ui: f.ui,
          optional: f.optional,
        };
        if (f.default !== undefined) out.default = f.default;
        if (f.validation) out.validation = f.validation;
        if (f.previousName !== null && f.previousName !== f.name) {
          out.previousName = f.previousName;
        }
        return out;
      }),
    };
    if (isCreate.value) {
      await api.createBlueprint(payload as BlueprintMeta);
    } else {
      await api.updateBlueprint(props.handle!, payload as never);
    }
    await store.refresh();
    router.push(`/schema/${handle.value}`);
  } catch (err) {
    const e = err as { response?: ApiError };
    if (e.response?.error === 'validation' && e.response.issues) {
      for (const issue of e.response.issues) {
        const key = issue.path.join('.');
        errors[key] = issue.message;
      }
      submitError.value = 'Some fields are invalid; see inline messages.';
    } else {
      submitError.value = e.response?.message ?? 'Failed to save';
    }
  } finally {
    saving.value = false;
  }
}

async function destroy() {
  if (!props.handle) return;
  if (!confirm(`Delete blueprint '${props.handle}' and ALL its entries?`)) return;
  await api.deleteBlueprint(props.handle);
  await store.refresh();
  router.push('/schema');
}
</script>

<template>
  <div class="p-6" data-testid="blueprint-editor">
    <h1 class="mb-4 text-xl font-semibold">{{ isCreate ? 'New collection' : `Edit ${handle}` }}</h1>

    <form class="max-w-3xl space-y-6" @submit.prevent="save">
      <div class="space-y-3 rounded border border-zinc-200 bg-white p-4">
        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Handle</span>
          <input
            v-model="handle"
            :disabled="!isCreate"
            class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100"
            data-testid="blueprint-handle"
          />
          <span v-if="errors['handle']" class="mt-1 block text-xs text-red-600">{{ errors['handle'] }}</span>
        </label>
        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Label</span>
          <input
            v-model="label"
            class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            data-testid="blueprint-label"
          />
          <span v-if="errors['label']" class="mt-1 block text-xs text-red-600">{{ errors['label'] }}</span>
        </label>
        <label class="flex items-center gap-2">
          <input
            v-model="singleton"
            type="checkbox"
            class="rounded border-zinc-300"
            data-testid="blueprint-singleton"
          />
          <span class="text-sm font-medium text-zinc-700">Singleton (only one entry)</span>
        </label>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold text-zinc-700">Fields</h2>
          <button
            type="button"
            class="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            data-testid="add-field"
            @click="addField"
          >
            + Add field
          </button>
        </div>

        <div
          v-for="(f, i) in fields"
          :key="i"
          class="rounded border border-zinc-200 bg-white"
          :data-testid="`field-card-${f.name || `new-${i}`}`"
        >
          <div class="flex items-center gap-2 px-3 py-2">
            <button type="button" class="px-2 text-zinc-400 hover:text-zinc-700" :data-testid="`field-up-${i}`" @click="moveUp(i)">↑</button>
            <button type="button" class="px-2 text-zinc-400 hover:text-zinc-700" :data-testid="`field-down-${i}`" @click="moveDown(i)">↓</button>
            <div class="flex-1">
              <button
                type="button"
                class="text-left"
                @click="expandedIndex = expandedIndex === i ? null : i"
              >
                <span class="font-mono text-sm">{{ f.name || '(new field)' }}</span>
                <span class="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{{ f.ui.kind }}</span>
                <span v-if="!f.optional" class="ml-1 rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">required</span>
              </button>
            </div>
            <button
              type="button"
              class="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
              :data-testid="`field-remove-${i}`"
              @click="removeField(i)"
            >
              Remove
            </button>
          </div>

          <div v-if="expandedIndex === i" class="space-y-3 border-t border-zinc-200 px-3 py-3">
            <label class="block">
              <span class="block text-xs font-medium text-zinc-600">Name</span>
              <input
                v-model="f.name"
                class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
                :data-testid="`field-name-${i}`"
              />
            </label>
            <label class="block">
              <span class="block text-xs font-medium text-zinc-600">Label</span>
              <input
                v-model="f.label"
                class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label class="block">
              <span class="block text-xs font-medium text-zinc-600">Kind</span>
              <select
                class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
                :value="f.ui.kind"
                :data-testid="`field-kind-${i}`"
                @change="setKind(i, ($event.target as HTMLSelectElement).value as FieldUi['kind'])"
              >
                <option value="text">text</option>
                <option value="textarea">textarea</option>
                <option value="blocks">blocks</option>
                <option value="date">date</option>
                <option value="boolean">boolean</option>
                <option value="select">select</option>
                <option value="relationship">relationship</option>
              </select>
            </label>
            <label class="flex items-center gap-2">
              <input v-model="f.optional" type="checkbox" class="rounded border-zinc-300" :data-testid="`field-optional-${i}`" />
              <span class="text-xs font-medium text-zinc-600">Optional</span>
            </label>

            <!-- text/textarea: min/max -->
            <div v-if="f.ui.kind === 'text' || f.ui.kind === 'textarea'" class="flex gap-3">
              <label class="block flex-1">
                <span class="block text-xs font-medium text-zinc-600">Min length</span>
                <input
                  type="number"
                  :value="f.validation?.min ?? ''"
                  class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
                  @input="
                    f.validation = {
                      ...(f.validation ?? {}),
                      min: ($event.target as HTMLInputElement).value === ''
                        ? undefined
                        : Number(($event.target as HTMLInputElement).value),
                    }
                  "
                />
              </label>
              <label class="block flex-1">
                <span class="block text-xs font-medium text-zinc-600">Max length</span>
                <input
                  type="number"
                  :value="f.validation?.max ?? ''"
                  class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
                  @input="
                    f.validation = {
                      ...(f.validation ?? {}),
                      max: ($event.target as HTMLInputElement).value === ''
                        ? undefined
                        : Number(($event.target as HTMLInputElement).value),
                    }
                  "
                />
              </label>
            </div>

            <!-- select: options editor -->
            <div v-if="f.ui.kind === 'select'">
              <span class="block text-xs font-medium text-zinc-600">Options</span>
              <textarea
                rows="3"
                class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 font-mono text-xs"
                :value="(f.ui.options ?? []).join('\n')"
                :data-testid="`field-options-${i}`"
                @input="
                  f.ui = {
                    kind: 'select',
                    options: ($event.target as HTMLTextAreaElement).value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }
                "
              />
              <span class="text-xs text-zinc-500">One option per line.</span>
            </div>

            <!-- relationship: target picker -->
            <label v-if="f.ui.kind === 'relationship'" class="block">
              <span class="block text-xs font-medium text-zinc-600">Target collection</span>
              <select
                class="mt-1 w-full rounded border border-zinc-300 px-3 py-1.5 text-sm"
                :value="f.ui.to ?? ''"
                :data-testid="`field-to-${i}`"
                @change="f.ui = { kind: 'relationship', to: ($event.target as HTMLSelectElement).value }"
              >
                <option value="" disabled>Choose a collection</option>
                <option v-for="bp in store.list" :key="bp.handle" :value="bp.handle">{{ bp.handle }}</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <div v-if="submitError" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ submitError }}
      </div>

      <div class="flex items-center gap-2">
        <button
          type="submit"
          class="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          :disabled="saving"
          data-testid="blueprint-save"
        >
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <RouterLink
          to="/schema"
          class="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          data-testid="blueprint-cancel"
        >
          Cancel
        </RouterLink>
        <button
          v-if="!isCreate"
          type="button"
          class="ml-auto rounded border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          data-testid="blueprint-delete"
          @click="destroy"
        >
          Delete
        </button>
      </div>
    </form>
  </div>
</template>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @vulse/admin check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/admin/src/pages/BlueprintEditor.vue
git commit -m "feat(admin): BlueprintEditor page with field add/remove/reorder and kind-specific inputs"
```

---

### Task D4: Editor tests

**Files:**
- Create: `packages/admin/src/pages/__tests__/BlueprintEditor.test.ts`

- [ ] **Step 1: Write `packages/admin/src/pages/__tests__/BlueprintEditor.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import BlueprintEditor from '../BlueprintEditor.vue';
import * as client from '../../api/client.js';

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/schema', component: { template: '<div/>' } }, { path: '/schema/:handle', component: { template: '<div/>' } }] });

beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(client.api, 'meta').mockResolvedValue([]);
  vi.spyOn(client.api, 'getBlueprint').mockResolvedValue({
    handle: 'posts',
    label: 'Posts',
    singleton: false,
    fields: [
      { name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false },
      { name: 'body', label: 'Body', ui: { kind: 'blocks' }, optional: false },
    ],
  });
});

function mountEditor(handle: string | null) {
  return mount(BlueprintEditor, {
    props: { handle },
    global: { plugins: [router] },
  });
}

describe('BlueprintEditor', () => {
  it('add field appends a card', async () => {
    const w = mountEditor(null);
    await flushPromises();
    expect(w.findAll('[data-testid^="field-card-"]')).toHaveLength(0);
    await w.find('[data-testid="add-field"]').trigger('click');
    expect(w.findAll('[data-testid^="field-card-"]')).toHaveLength(1);
  });

  it('reorders fields with up/down buttons', async () => {
    const w = mountEditor('posts');
    await flushPromises();
    const cards = () =>
      w.findAll('[data-testid^="field-card-"]').map((el) => el.attributes('data-testid'));
    expect(cards()).toEqual(['field-card-title', 'field-card-body']);
    await w.find('[data-testid="field-down-0"]').trigger('click');
    expect(cards()).toEqual(['field-card-body', 'field-card-title']);
  });

  it('switching kind to select reveals the options editor', async () => {
    const w = mountEditor('posts');
    await flushPromises();
    // Expand the first field
    await w.find('[data-testid^="field-card-title"] button').trigger('click');
    // Change kind to select
    const select = w.find('[data-testid="field-kind-0"]');
    await select.setValue('select');
    expect(w.find('[data-testid="field-options-0"]').exists()).toBe(true);
  });

  it('submits previousName only when name was renamed', async () => {
    const createSpy = vi.spyOn(client.api, 'updateBlueprint').mockResolvedValue({
      handle: 'posts',
      label: 'Posts',
      singleton: false,
      fields: [],
    });
    const w = mountEditor('posts');
    await flushPromises();

    // Rename 'title' → 'headline' in the first field
    await w.find('[data-testid^="field-card-title"] button').trigger('click');
    await w.find('[data-testid="field-name-0"]').setValue('headline');

    await w.find('[data-testid="blueprint-save"]').trigger('click');
    await flushPromises();

    expect(createSpy).toHaveBeenCalled();
    const payload = createSpy.mock.calls[0]![1];
    expect(payload.fields[0]).toMatchObject({ name: 'headline', previousName: 'title' });
    // Second field unchanged → no previousName key.
    expect(payload.fields[1]!.previousName).toBeUndefined();
  });

  it('newly added fields submit without a previousName', async () => {
    const createSpy = vi.spyOn(client.api, 'createBlueprint').mockResolvedValue({
      handle: 'pages',
      label: 'Pages',
      singleton: false,
      fields: [],
    });
    const w = mountEditor(null);
    await flushPromises();

    await w.find('[data-testid="blueprint-handle"]').setValue('pages');
    await w.find('[data-testid="blueprint-label"]').setValue('Pages');
    await w.find('[data-testid="add-field"]').trigger('click');
    await w.find('[data-testid="field-name-0"]').setValue('title');

    await w.find('[data-testid="blueprint-save"]').trigger('click');
    await flushPromises();

    expect(createSpy).toHaveBeenCalled();
    const payload = createSpy.mock.calls[0]![0];
    expect(payload.fields[0]).toMatchObject({ name: 'title' });
    expect(payload.fields[0].previousName).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — verify pass**

Run: `pnpm --filter @vulse/admin test BlueprintEditor`
Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/admin
git commit -m "test(admin): BlueprintEditor add/remove/reorder/kind-switch/previousName behavior"
```

---

## Phase E — Boot wiring & smoke

### Task E1: Wire `vite.config.ts` and `server.prod.ts` to seed + subscribe to mutations

**Files:**
- Modify: `packages/core/src/vite/plugin.ts`
- Modify: `apps/dev/src/server.prod.ts`

- [ ] **Step 1: Replace `packages/core/src/vite/plugin.ts`**

```ts
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import type { Plugin, ViteDevServer } from 'vite';
import { loadBlueprints } from '../blueprints/load.js';
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
import { createContentService } from '../content/service.js';
import { createApi } from '../http/api.js';
import { blueprintEvents } from '../events.js';

export interface VulseDevOptions {
  blueprintsDir: string;
  database: ConstructorParameters<typeof LibsqlAdapter>[0];
}

export function vulseDevPlugin(opts: VulseDevOptions): Plugin {
  let adapter: LibsqlAdapter | null = null;

  return {
    name: 'vulse:dev',
    apply: 'serve',

    async configureServer(server: ViteDevServer) {
      adapter = new LibsqlAdapter(opts.database);
      await adapter.exec('PRAGMA foreign_keys = ON');
      await runMigrations(adapter, MIGRATIONS_DIR);
      await seedBlueprintsFromCode({ adapter, dir: opts.blueprintsDir });

      async function build() {
        const blueprints = await loadBlueprints({ adapter: adapter! });
        const content = createContentService(adapter!, blueprints);
        return createApi({ blueprints, content, adapter: adapter! });
      }

      let app = await build();

      const onChange = async () => {
        app = await build();
        server.ws.send({ type: 'custom', event: 'vulse:blueprints-changed' });
      };
      blueprintEvents.on('change', onChange);

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next();
        try {
          const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') headers.set(k, v);
            else if (Array.isArray(v)) headers.set(k, v.join(','));
          }
          const method = req.method ?? 'GET';
          const hasBody = method !== 'GET' && method !== 'HEAD';
          const init: RequestInit = { method, headers };
          if (hasBody) {
            const buf = await readBody(req);
            init.body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as BodyInit;
          }
          const fetchReq = new Request(url.toString(), init);
          const fetchRes = await app.fetch(fetchReq);
          res.statusCode = fetchRes.status;
          fetchRes.headers.forEach((v, k) => res.setHeader(k, v));
          const buf = Buffer.from(await fetchRes.arrayBuffer());
          res.end(buf);
        } catch (err) {
          next(err as Error);
        }
      });
    },

    async closeBundle() {
      await adapter?.close();
    },
  };
}

import type { IncomingMessage } from 'node:http';
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
```

- [ ] **Step 2: Replace `apps/dev/src/server.prod.ts`**

```ts
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  blueprintEvents,
  createApi,
  createContentService,
  loadBlueprints,
  seedBlueprintsFromCode,
} from '@vulse/core';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { Hono } from 'hono';

const __dirname = dirname(fileURLToPath(import.meta.url));

const db = new LibsqlAdapter({ url: process.env.VULSE_DB_URL ?? 'file:./dev.db' });
await db.exec('PRAGMA foreign_keys = ON');
await runMigrations(db, MIGRATIONS_DIR);

const blueprintsDir = resolve(__dirname, '..', 'blueprints');
await seedBlueprintsFromCode({ adapter: db, dir: blueprintsDir });

async function buildApp(): Promise<Hono> {
  const blueprints = await loadBlueprints({ adapter: db });
  const content = createContentService(db, blueprints);
  const api = createApi({ blueprints, content, adapter: db });
  const root = new Hono();
  root.route('/', api);
  root.use('/*', serveStatic({ root: resolve(__dirname, '..', 'dist') }));
  return root;
}

let app = await buildApp();
blueprintEvents.on('change', async () => {
  app = await buildApp();
});

const port = Number(process.env.PORT ?? '3000');
serve({ fetch: (req) => app.fetch(req), port }, ({ port }) => {
  console.log(`Vulse listening on http://localhost:${port}`);
});
```

- [ ] **Step 3: Build core (so the dev plugin gets picked up by Vite) and typecheck the workspace**

Run: `pnpm --filter @vulse/core build && pnpm -r run check`
Expected: all packages clean.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/vite/plugin.ts apps/dev/src/server.prod.ts
git commit -m "feat(boot): seed on startup; live-rebuild API on blueprint events"
```

---

### Task E2: Smoke test gains a rename assertion

**Files:**
- Modify: `apps/dev/src/smoke.test.ts`

- [ ] **Step 1: Append a third `it(...)` block at the bottom of the existing `describe('apps/dev smoke', ...)` in `apps/dev/src/smoke.test.ts`**

```ts
  it('renames a field on a blueprint and reflects it in /api/_meta/collections', async () => {
    // Read the current Posts definition
    const getRes = await fetch(`${base}/api/blueprints/posts`);
    expect(getRes.status).toBe(200);
    const current = (await getRes.json()) as {
      handle: string;
      label: string;
      singleton: boolean;
      fields: { name: string; ui: { kind: string }; optional: boolean }[];
    };

    // Rename 'title' to 'headline' (preserve everything else)
    const renamed = {
      handle: current.handle,
      label: current.label,
      singleton: current.singleton,
      fields: current.fields.map((f) =>
        f.name === 'title' ? { ...f, name: 'headline', previousName: 'title' } : f,
      ),
    };
    const patchRes = await fetch(`${base}/api/blueprints/posts`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(renamed),
    });
    expect(patchRes.status).toBe(200);

    // The content meta must reflect the new field name on the next request.
    const metaRes = await fetch(`${base}/api/_meta/collections`);
    const meta = (await metaRes.json()) as { handle: string; fields: { name: string }[] }[];
    const posts = meta.find((m) => m.handle === 'posts')!;
    expect(posts.fields.map((f) => f.name)).toContain('headline');
    expect(posts.fields.map((f) => f.name)).not.toContain('title');

    // Posting content with the new field name succeeds.
    const created = await fetch(`${base}/api/collections/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        headline: 'After Rename',
        slug: 'after',
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
        status: 'draft',
      }),
    });
    expect(created.status).toBe(201);
  });
```

- [ ] **Step 2: Run smoke test**

Run: `pnpm --filter @vulse/dev test`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/dev/src/smoke.test.ts
git commit -m "test(dev): smoke verifies PATCH rename is visible in /api/_meta/collections"
```

---

## Phase F — Final verification

### Task F1: Workspace sweep

- [ ] **Step 1: Run all checks**

Run: `pnpm install && pnpm -r run check`
Expected: all five packages typecheck clean.

- [ ] **Step 2: Run full test suite**

Run: `pnpm exec vitest run`
Expected: counts roughly:
- `@vulse/db`: 10
- `@vulse/core`: 9 compile + 4 load + 3 seed + 12 mutations + 9 content + 6 api + 7 blueprints api = 50
- `@vulse/renderer`: 6
- `@vulse/admin`: 5 FieldRenderer + 2 RelationshipField + 2 blueprints store + 5 BlueprintEditor = 14
- `@vulse/dev`: 3
- **Total ≈ 83 tests** (up from 45 in v1)

- [ ] **Step 3: Manual smoke**

Run: `rm -f apps/dev/dev.db && pnpm dev`
In a browser at `http://localhost:5173`:
1. Sidebar shows two groups: **Collections** (Posts, Authors) and **Schema** (Posts, Authors, + New collection).
2. Click **Schema → Posts** → editor loads with eight fields.
3. Expand the *title* field, rename to *headline*, click Save. Sidebar refreshes; navigate to **Collections → Posts → New entry** — the form now shows a *Headline* field.
4. Click **Schema → + New collection** → fill handle `pages`, label `Pages`, add a single `title` text field, Save. Sidebar gains *Pages* in both groups.
5. Click **Schema → Pages → Delete** → confirm. Sidebar removes *Pages* in both groups.

- [ ] **Step 4: Commit (no-op if clean)**

```bash
git status
# if anything is dangling, commit it; otherwise:
git commit --allow-empty -m "chore: blueprint-editor verification pass"
```

---

## Self-review

**Spec coverage:**

| Spec section | Plan task |
|---|---|
| §3.1 migration 006 | A1 |
| §3.2 BlueprintDefinition shape | B1 |
| §3.3 rename rewrite, orphan retention, no retype migration | B5 |
| §4.1 schema compiler | B2 |
| §4.2 loader rewrite + reloadBlueprint | B4 |
| §4.3 seeder | B4 |
| §4.4 createBlueprint / updateBlueprint / deleteBlueprint | B5 |
| §4.5 definition validation (cross-field) | B5 |
| §5 API routes | C1 |
| §5 PATCH `previousName` semantics | B5 + D3 + C1 |
| §6.1 sidebar two groups | D2 |
| §6.2 routes | D2 |
| §6.3 editor page | D3 |
| §6.4 previousName tracking client-side | D3 + D4 |
| §7 boot order with seed + event subscription | E1 |
| §8 testing additions | B2, B4, B5, C1, D4, E2 |

**Placeholder scan:** no TBD / TODO / "similar to" / unscoped commentary. Each step has executable code or a runnable command.

**Type consistency:**
- `BlueprintDefinition` shape is identical between `definition.ts` and the admin client's interface (B1 + D1).
- `previousName` lives only on `FieldDefinitionWithRename`, not the canonical `FieldDefinition`. Server strips it before persisting (B5 `stripRenames`).
- `createApi` gains an `adapter` dep; both the dev plugin (E1) and `server.prod.ts` (E1) and `api.test.ts` setup (C1 Step 2) pass it.
- `blueprintEvents` is emitted by mutations (B5) and consumed by the dev plugin (E1) and prod server (E1).
- The admin's `useBlueprintsStore.refresh()` is added in D1 and invoked from the editor in D3.

One known small wart: in B5 the `parseOrThrow` helper casts `ValidationError`'s `issues` from `unknown[]` to `never` because the project's Zod-v4 generic shape for `safeParse` errors doesn't match `ZodIssue[]` directly. This matches existing patterns in the v1 codebase (`content/service.ts` does the same). Not a plan failure.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-blueprint-editor.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

Which approach?
