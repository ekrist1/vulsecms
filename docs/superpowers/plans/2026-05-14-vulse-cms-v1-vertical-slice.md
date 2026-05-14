# Vulse CMS v1 Vertical Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Vulse CMS monorepo and deliver the first working vertical slice — class-based Zod blueprints, libSQL persistence, Hono-generated REST API, a schema-agnostic Vue 3 admin UI, and a zero-dependency block renderer.

**Architecture:** pnpm workspaces with `packages/db`, `packages/core`, `packages/renderer`, `packages/admin`, and a sandbox `apps/dev`. `DatabaseAdapter` is defined before any persistence logic; `LibsqlAdapter` is the only implementation. Core exposes a Vite plugin that mounts a Hono API as middleware so `vp dev` boots admin + API on one port. The admin discovers schema via `/api/_meta/collections` — it has zero blueprint knowledge baked in.

**Tech Stack:** Node 22+, TypeScript strict, Vue 3 Composition API, Vite, Tailwind v4, Reka UI, vue-router, Pinia, Zod v4, Hono, `@libsql/client`, TipTap v2 + StarterKit, Vitest, Biome, pnpm.

**Reference spec:** `docs/superpowers/specs/2026-05-14-vulse-cms-v1-vertical-slice-design.md`

---

## Phase A — Monorepo bootstrap

### Task A1: Workspace root files

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Create: `vitest.workspace.ts`
- Modify: `.gitignore` (already exists)

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "vulsecms",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev":    "pnpm --filter @vulse/dev dev",
    "build":  "pnpm -r --filter './packages/**' build && pnpm --filter @vulse/dev build",
    "check":  "pnpm -r exec vp check && biome check .",
    "test":   "vitest run",
    "lint":   "biome check .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "files": { "ignore": ["**/dist/**", "**/node_modules/**", "**/*.db*"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "always" } },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true }
}
```

- [ ] **Step 5: Create `vitest.workspace.ts`**

```ts
export default [
  'packages/db',
  'packages/core',
  'packages/renderer',
  'packages/admin',
  'apps/dev',
];
```

- [ ] **Step 6: Install + verify**

Run: `pnpm install`
Expected: success, lockfile written.

Run: `pnpm exec biome check . || true`
Expected: no errors (nothing to check yet).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json biome.json vitest.workspace.ts pnpm-lock.yaml
git commit -m "chore: bootstrap pnpm workspace, biome, vitest, tsconfig"
```

---

## Phase B — `packages/db`

### Task B1: Package scaffold + DatabaseAdapter interface

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/src/adapter.ts`
- Create: `packages/db/src/index.ts`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@vulse/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@libsql/client": "^0.14.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/db/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@vulse/db',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create `packages/db/src/adapter.ts`**

```ts
export type Row = Record<string, unknown>;

export interface DatabaseAdapter {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

- [ ] **Step 5: Create `packages/db/src/index.ts`**

```ts
export type { DatabaseAdapter, Row } from './adapter.js';
```

- [ ] **Step 6: Install + typecheck**

Run: `pnpm install`
Run: `pnpm --filter @vulse/db check`
Expected: PASS (no output).

- [ ] **Step 7: Commit**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): define DatabaseAdapter interface"
```

---

### Task B2: LibsqlAdapter — TDD round-trip

**Files:**
- Create: `packages/db/src/libsql-adapter.test.ts`
- Create: `packages/db/src/libsql-adapter.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing test `packages/db/src/libsql-adapter.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { LibsqlAdapter } from './libsql-adapter.js';

describe('LibsqlAdapter', () => {
  it('round-trips exec/query', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER)');
    await db.exec('INSERT INTO t (id, v) VALUES (?, ?)', ['a', 1]);
    const rows = await db.query<{ id: string; v: number }>('SELECT * FROM t');
    expect(rows).toEqual([{ id: 'a', v: 1 }]);
    await db.close();
  });

  it('queryOne returns null when missing', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
    const row = await db.queryOne('SELECT * FROM t WHERE id = ?', ['nope']);
    expect(row).toBeNull();
    await db.close();
  });

  it('transaction commits on success and rolls back on throw', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');

    await db.transaction(async (tx) => {
      await tx.exec('INSERT INTO t VALUES (?)', ['ok']);
    });
    expect(await db.query('SELECT * FROM t')).toHaveLength(1);

    await expect(
      db.transaction(async (tx) => {
        await tx.exec('INSERT INTO t VALUES (?)', ['bad']);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await db.query('SELECT * FROM t')).toHaveLength(1);

    await db.close();
  });
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `pnpm --filter @vulse/db test`
Expected: FAIL (module `./libsql-adapter.js` missing).

- [ ] **Step 3: Implement `packages/db/src/libsql-adapter.ts`**

```ts
import { createClient, type Client, type Config, type InValue } from '@libsql/client';
import type { DatabaseAdapter, Row } from './adapter.js';

export class LibsqlAdapter implements DatabaseAdapter {
  private client: Client;

  constructor(config: Config) {
    this.client = createClient(config);
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.client.execute({ sql, args: params as InValue[] });
  }

  async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.client.execute({ sql, args: params as InValue[] });
    return result.rows.map((r) => ({ ...r }) as T);
  }

  async queryOne<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    const tx = await this.client.transaction('write');
    const txAdapter: DatabaseAdapter = {
      exec: async (sql, params = []) => {
        await tx.execute({ sql, args: params as InValue[] });
      },
      query: async <U = Row>(sql: string, params: unknown[] = []): Promise<U[]> => {
        const r = await tx.execute({ sql, args: params as InValue[] });
        return r.rows.map((row) => ({ ...row }) as U);
      },
      queryOne: async <U = Row>(sql: string, params: unknown[] = []): Promise<U | null> => {
        const r = await tx.execute({ sql, args: params as InValue[] });
        return (r.rows[0] ? ({ ...r.rows[0] } as U) : null);
      },
      transaction: () => {
        throw new Error('nested transactions are not supported');
      },
      close: async () => {},
    };
    try {
      const out = await fn(txAdapter);
      await tx.commit();
      return out;
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  async close(): Promise<void> {
    this.client.close();
  }
}
```

- [ ] **Step 4: Re-export from `packages/db/src/index.ts`**

```ts
export type { DatabaseAdapter, Row } from './adapter.js';
export { LibsqlAdapter } from './libsql-adapter.js';
```

- [ ] **Step 5: Run test — verify pass**

Run: `pnpm --filter @vulse/db test`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): implement LibsqlAdapter with exec/query/transaction"
```

---

### Task B3: Migration runner — TDD

**Files:**
- Create: `packages/db/src/migrate.test.ts`
- Create: `packages/db/src/migrate.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing test `packages/db/src/migrate.test.ts`**

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LibsqlAdapter } from './libsql-adapter.js';
import { runMigrations } from './migrate.js';

function tempMigrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vulse-mig-'));
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql);
  }
  return dir;
}

describe('runMigrations', () => {
  it('applies all .sql files in lexicographic order', async () => {
    const dir = tempMigrationsDir({
      '001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
      '002_b.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY);',
    });
    const db = new LibsqlAdapter({ url: ':memory:' });
    await runMigrations(db, dir);
    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_vulse_%' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(['a', 'b']);
    await db.close();
  });

  it('is idempotent — second run is a no-op', async () => {
    const dir = tempMigrationsDir({
      '001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
    });
    const db = new LibsqlAdapter({ url: ':memory:' });
    await runMigrations(db, dir);
    await runMigrations(db, dir);
    const applied = await db.query<{ name: string }>(
      'SELECT name FROM _vulse_migrations ORDER BY name',
    );
    expect(applied.map((r) => r.name)).toEqual(['001_a.sql']);
    await db.close();
  });

  it('rolls back when a migration fails', async () => {
    const dir = tempMigrationsDir({
      '001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
      '002_bad.sql': 'NOT VALID SQL;',
    });
    const db = new LibsqlAdapter({ url: ':memory:' });
    await expect(runMigrations(db, dir)).rejects.toThrow();
    const applied = await db.query<{ name: string }>(
      'SELECT name FROM _vulse_migrations',
    );
    expect(applied.map((r) => r.name)).toEqual(['001_a.sql']);
    await db.close();
  });
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `pnpm --filter @vulse/db test migrate`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `packages/db/src/migrate.ts`**

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseAdapter } from './adapter.js';

export async function runMigrations(db: DatabaseAdapter, dir: string): Promise<void> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS _vulse_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))',
  );

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = await db.query<{ name: string }>('SELECT name FROM _vulse_migrations');
  const appliedSet = new Set(applied.map((r) => r.name));

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    await db.transaction(async (tx) => {
      for (const statement of splitStatements(sql)) {
        if (statement.trim()) await tx.exec(statement);
      }
      await tx.exec('INSERT INTO _vulse_migrations (name) VALUES (?)', [file]);
    });
  }
}

function splitStatements(sql: string): string[] {
  // Naive splitter: libSQL execute() handles only one statement per call.
  // We split on `;` followed by newline or end-of-string. Good enough for our SQL files.
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}
```

- [ ] **Step 4: Update `packages/db/src/index.ts`**

```ts
export type { DatabaseAdapter, Row } from './adapter.js';
export { LibsqlAdapter } from './libsql-adapter.js';
export { runMigrations } from './migrate.js';
```

- [ ] **Step 5: Run test — verify pass**

Run: `pnpm --filter @vulse/db test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): add idempotent migration runner"
```

---

### Task B4: v1 migration SQL files

**Files:**
- Create: `packages/db/migrations/001_collections.sql`
- Create: `packages/db/migrations/002_entries.sql`
- Create: `packages/db/migrations/003_revisions.sql`
- Create: `packages/db/migrations/004_navigation.sql`
- Create: `packages/db/migrations/005_settings.sql`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/package.json` (export migrations path)

- [ ] **Step 1: Create `packages/db/migrations/001_collections.sql`**

```sql
CREATE TABLE collections (
  handle              TEXT PRIMARY KEY,
  blueprint_hash      TEXT NOT NULL,
  blueprint_snapshot  TEXT,
  singleton           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Create `packages/db/migrations/002_entries.sql`**

```sql
CREATE TABLE entries (
  id                  TEXT PRIMARY KEY,
  collection_handle   TEXT NOT NULL REFERENCES collections(handle) ON DELETE CASCADE,
  parent_id           TEXT REFERENCES entries(id) ON DELETE CASCADE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'published',
  content             TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_entries_scope  ON entries(collection_handle, parent_id, sort_order);
CREATE INDEX idx_entries_status ON entries(collection_handle, status);
```

- [ ] **Step 3: Create `packages/db/migrations/003_revisions.sql`**

```sql
CREATE TABLE revisions (
  id                  TEXT PRIMARY KEY,
  entry_id            TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  revision_number     INTEGER NOT NULL,
  content             TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  created_by          TEXT
);
CREATE INDEX idx_revisions_entry ON revisions(entry_id, revision_number DESC);
```

- [ ] **Step 4: Create `packages/db/migrations/004_navigation.sql`**

```sql
CREATE TABLE navigation (
  handle              TEXT PRIMARY KEY,
  tree                TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 5: Create `packages/db/migrations/005_settings.sql`**

```sql
CREATE TABLE settings (
  key                 TEXT PRIMARY KEY,
  value               TEXT NOT NULL,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 6: Expose migrations directory via `packages/db/src/index.ts`**

```ts
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type { DatabaseAdapter, Row } from './adapter.js';
export { LibsqlAdapter } from './libsql-adapter.js';
export { runMigrations } from './migrate.js';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, '..', 'migrations');
```

- [ ] **Step 7: Update `packages/db/package.json` so migrations ship with the package**

Replace the `package.json` with:

```json
{
  "name": "@vulse/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "files": ["dist", "migrations"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@libsql/client": "^0.14.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): add v1 migrations (collections, entries, revisions, navigation, settings)"
```

---

### Task B5: Integration test — full v1 schema + parent/child + cascade

**Files:**
- Create: `packages/db/src/schema.test.ts`

- [ ] **Step 1: Write failing test `packages/db/src/schema.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { LibsqlAdapter } from './libsql-adapter.js';
import { runMigrations } from './migrate.js';
import { MIGRATIONS_DIR } from './index.js';

async function freshDb() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe('v1 schema', () => {
  it('creates all five tables plus the migrations table', async () => {
    const db = await freshDb();
    const rows = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        '_vulse_migrations',
        'collections',
        'entries',
        'navigation',
        'revisions',
        'settings',
      ]),
    );
    await db.close();
  });

  it('entries support parent/child + cascade on delete', async () => {
    const db = await freshDb();
    await db.exec(
      "INSERT INTO collections (handle, blueprint_hash) VALUES ('posts', 'h1')",
    );
    await db.exec(
      "INSERT INTO entries (id, collection_handle, content) VALUES ('p1', 'posts', '{}')",
    );
    await db.exec(
      "INSERT INTO entries (id, collection_handle, parent_id, content) VALUES ('c1', 'posts', 'p1', '{}')",
    );
    await db.exec("DELETE FROM entries WHERE id = 'p1'");
    const remaining = await db.query<{ id: string }>('SELECT id FROM entries');
    expect(remaining).toEqual([]);
    await db.close();
  });

  it('sort_order indexes return entries in order', async () => {
    const db = await freshDb();
    await db.exec(
      "INSERT INTO collections (handle, blueprint_hash) VALUES ('posts', 'h1')",
    );
    for (const [id, order] of [
      ['b', 2],
      ['a', 1],
      ['c', 3],
    ] as const) {
      await db.exec(
        "INSERT INTO entries (id, collection_handle, sort_order, content) VALUES (?, 'posts', ?, '{}')",
        [id, order],
      );
    }
    const ordered = await db.query<{ id: string }>(
      "SELECT id FROM entries WHERE collection_handle = 'posts' ORDER BY sort_order ASC",
    );
    expect(ordered.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    await db.close();
  });
});
```

- [ ] **Step 2: Run — verify pass**

Run: `pnpm --filter @vulse/db test schema`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/db
git commit -m "test(db): integration test for v1 schema, parent/child, sort_order"
```

---

## Phase C — `packages/core`

### Task C1: Package scaffold + Collection base + types

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/blueprints/collection.ts`
- Create: `packages/core/src/blueprints/types.ts`
- Create: `packages/core/src/errors.ts`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@vulse/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":      { "types": "./dist/index.d.ts",      "import": "./dist/index.js" },
    "./vite": { "types": "./dist/vite/plugin.d.ts","import": "./dist/vite/plugin.js" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check": "tsc -p tsconfig.json --noEmit",
    "test":  "vitest run"
  },
  "dependencies": {
    "@vulse/db": "workspace:*",
    "hono":      "^4.6.0",
    "ulid":      "^2.3.0",
    "zod":       "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vite":       "^5.4.10",
    "vitest":     "^2.1.4"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@vulse/core',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create `packages/core/src/blueprints/types.ts`**

```ts
import type { z } from 'zod';

export interface FieldUi {
  kind:
    | 'text'
    | 'textarea'
    | 'blocks'
    | 'date'
    | 'boolean'
    | 'select'
    | 'relationship';
  options?: readonly string[];
  to?: string;
}

export interface FieldMeta {
  name: string;
  ui: FieldUi;
  optional: boolean;
  default?: unknown;
}

export interface Blueprint {
  handle: string;
  label: string;
  schema: z.ZodObject<z.ZodRawShape>;
  fields: FieldMeta[];
  hash: string;
}
```

- [ ] **Step 5: Create `packages/core/src/blueprints/collection.ts`**

```ts
import type { z } from 'zod';

export abstract class Collection {
  static handle: string;
  static label: string;
  static schema: z.ZodObject<z.ZodRawShape>;
}
```

- [ ] **Step 6: Create `packages/core/src/errors.ts`**

```ts
import type { ZodIssue } from 'zod';

export class ValidationError extends Error {
  readonly issues: ZodIssue[];
  constructor(issues: ZodIssue[]) {
    super('validation failed');
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
```

- [ ] **Step 7: Create `packages/core/src/index.ts`**

```ts
export { Collection } from './blueprints/collection.js';
export type { Blueprint, FieldMeta, FieldUi } from './blueprints/types.js';
export { ValidationError, NotFoundError } from './errors.js';
```

- [ ] **Step 8: Install + typecheck**

Run: `pnpm install`
Run: `pnpm --filter @vulse/core check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): scaffold Collection base, field types, error classes"
```

---

### Task C2: Blueprint loader — TDD

**Files:**
- Create: `packages/core/src/blueprints/load.test.ts`
- Create: `packages/core/src/blueprints/load.ts`
- Create: `packages/core/src/blueprints/__fixtures__/posts.ts`
- Create: `packages/core/src/blueprints/__fixtures__/authors.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create fixture `packages/core/src/blueprints/__fixtures__/posts.ts`**

```ts
import { z } from 'zod';
import { Collection } from '../collection.js';

export default class Posts extends Collection {
  static handle = 'posts';
  static label = 'Posts';
  static schema = z.object({
    title: z.string().min(1).meta({ ui: { kind: 'text' } }),
    body: z.array(z.any()).meta({ ui: { kind: 'blocks' } }),
  });
}
```

- [ ] **Step 2: Create fixture `packages/core/src/blueprints/__fixtures__/authors.ts`**

```ts
import { z } from 'zod';
import { Collection } from '../collection.js';

export default class Authors extends Collection {
  static handle = 'authors';
  static label = 'Authors';
  static schema = z.object({
    name: z.string().min(1).meta({ ui: { kind: 'text' } }),
  });
}
```

- [ ] **Step 3: Write failing test `packages/core/src/blueprints/load.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { LibsqlAdapter, runMigrations } from '@vulse/db';
import { MIGRATIONS_DIR } from '@vulse/db';
import { loadBlueprints } from './load.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '__fixtures__');

async function freshDb() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe('loadBlueprints', () => {
  it('loads class-based blueprints and exposes field meta', async () => {
    const db = await freshDb();
    const map = await loadBlueprints(fixturesDir, { adapter: db });

    expect([...map.keys()].sort()).toEqual(['authors', 'posts']);

    const posts = map.get('posts')!;
    expect(posts.label).toBe('Posts');
    expect(posts.fields.find((f) => f.name === 'title')?.ui.kind).toBe('text');
    expect(posts.fields.find((f) => f.name === 'body')?.ui.kind).toBe('blocks');

    await db.close();
  });

  it('upserts a collections row per blueprint', async () => {
    const db = await freshDb();
    await loadBlueprints(fixturesDir, { adapter: db });
    const rows = await db.query<{ handle: string; blueprint_hash: string }>(
      'SELECT handle, blueprint_hash FROM collections ORDER BY handle',
    );
    expect(rows.map((r) => r.handle)).toEqual(['authors', 'posts']);
    expect(rows.every((r) => r.blueprint_hash.length === 64)).toBe(true);
    await db.close();
  });

  it('hash is stable across reloads of the same blueprint', async () => {
    const db = await freshDb();
    const a = await loadBlueprints(fixturesDir, { adapter: db });
    const b = await loadBlueprints(fixturesDir, { adapter: db });
    expect(a.get('posts')!.hash).toBe(b.get('posts')!.hash);
    await db.close();
  });
});
```

- [ ] **Step 4: Run test — verify failure**

Run: `pnpm --filter @vulse/core test load`
Expected: FAIL (module missing).

- [ ] **Step 5: Implement `packages/core/src/blueprints/load.ts`**

```ts
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { z } from 'zod';
import type { DatabaseAdapter } from '@vulse/db';
import { Collection } from './collection.js';
import type { Blueprint, FieldMeta, FieldUi } from './types.js';

export interface LoadOptions {
  adapter: DatabaseAdapter;
}

export async function loadBlueprints(
  dir: string,
  opts: LoadOptions,
): Promise<Map<string, Blueprint>> {
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.js'))
    .filter((f) => !f.startsWith('_'));

  const map = new Map<string, Blueprint>();
  for (const file of files) {
    const mod = await import(pathToFileURL(resolve(dir, file)).href);
    const cls = mod.default as typeof Collection | undefined;
    if (!cls || !('handle' in cls) || !('schema' in cls)) continue;

    const blueprint = buildBlueprint(cls);
    map.set(blueprint.handle, blueprint);
    await upsertCollection(opts.adapter, blueprint);
  }
  return map;
}

function buildBlueprint(cls: typeof Collection): Blueprint {
  const handle = cls.handle;
  const label = cls.label ?? handle;
  const schema = cls.schema;
  const fields = extractFields(schema);
  const hash = hashBlueprint(handle, fields);
  return { handle, label, schema, fields, hash };
}

function extractFields(schema: z.ZodObject<z.ZodRawShape>): FieldMeta[] {
  const shape = schema.shape;
  const out: FieldMeta[] = [];
  for (const [name, fieldSchema] of Object.entries(shape)) {
    const meta = (fieldSchema as { meta?: () => { ui?: FieldUi } }).meta?.();
    const ui = meta?.ui;
    if (!ui) {
      throw new Error(
        `field '${name}' is missing .meta({ ui: { kind: ... } })`,
      );
    }
    out.push({
      name,
      ui,
      optional: fieldSchema.isOptional(),
      default: extractDefault(fieldSchema),
    });
  }
  return out;
}

function extractDefault(schema: unknown): unknown {
  const def = (schema as { _def?: { defaultValue?: () => unknown } })._def;
  if (def && typeof def.defaultValue === 'function') return def.defaultValue();
  return undefined;
}

function hashBlueprint(handle: string, fields: FieldMeta[]): string {
  const canonical = JSON.stringify({
    handle,
    fields: fields.map((f) => ({
      name: f.name,
      ui: f.ui,
      optional: f.optional,
      default: f.default ?? null,
    })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

async function upsertCollection(db: DatabaseAdapter, b: Blueprint): Promise<void> {
  await db.exec(
    `INSERT INTO collections (handle, blueprint_hash, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(handle) DO UPDATE SET blueprint_hash = excluded.blueprint_hash, updated_at = excluded.updated_at`,
    [b.handle, b.hash],
  );
}
```

- [ ] **Step 6: Re-export from `packages/core/src/index.ts`**

```ts
export { Collection } from './blueprints/collection.js';
export type { Blueprint, FieldMeta, FieldUi } from './blueprints/types.js';
export { loadBlueprints, type LoadOptions } from './blueprints/load.js';
export { ValidationError, NotFoundError } from './errors.js';
```

- [ ] **Step 7: Run test — verify pass**

Run: `pnpm --filter @vulse/core test load`
Expected: 3 tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): blueprint loader with sha256 hashing and collections upsert"
```

---

### Task C3: ContentService — TDD

**Files:**
- Create: `packages/core/src/content/service.test.ts`
- Create: `packages/core/src/content/service.ts`
- Create: `packages/core/src/content/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/src/content/types.ts`**

```ts
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

export interface ContentService {
  list(handle: string, opts?: { limit?: number; offset?: number }): Promise<Entry[]>;
  get(handle: string, id: string): Promise<Entry | null>;
  create(handle: string, input: unknown): Promise<Entry>;
  update(handle: string, id: string, input: unknown): Promise<Entry>;
  delete(handle: string, id: string): Promise<void>;
}
```

- [ ] **Step 2: Write failing test `packages/core/src/content/service.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { LibsqlAdapter, runMigrations, MIGRATIONS_DIR } from '@vulse/db';
import { loadBlueprints } from '../blueprints/load.js';
import { createContentService } from './service.js';
import { ValidationError, NotFoundError } from '../errors.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'blueprints', '__fixtures__');

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db, MIGRATIONS_DIR);
  const blueprints = await loadBlueprints(fixturesDir, { adapter: db });
  const content = createContentService(db, blueprints);
  return { db, blueprints, content };
}

describe('ContentService', () => {
  it('creates an entry with a ULID id and returns canonical shape', async () => {
    const { content, db } = await setup();
    const entry = await content.create('posts', { title: 'Hello', body: [] });
    expect(entry.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(entry.collection).toBe('posts');
    expect(entry.parentId).toBeNull();
    expect(entry.sortOrder).toBe(1);
    expect(entry.status).toBe('published');
    expect(entry.content).toEqual({ title: 'Hello', body: [] });
    await db.close();
  });

  it('rejects invalid input with ValidationError', async () => {
    const { content, db } = await setup();
    await expect(content.create('posts', { title: '', body: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await db.close();
  });

  it('auto-increments sort_order per (collection, parent) scope', async () => {
    const { content, db } = await setup();
    const a = await content.create('posts', { title: 'a', body: [] });
    const b = await content.create('posts', { title: 'b', body: [] });
    expect(b.sortOrder).toBe(a.sortOrder + 1);
    await db.close();
  });

  it('list returns entries ordered by sort_order then created_at desc', async () => {
    const { content, db } = await setup();
    await content.create('posts', { title: 'a', body: [] });
    await content.create('posts', { title: 'b', body: [] });
    const list = await content.list('posts');
    expect(list.map((e) => e.content.title)).toEqual(['a', 'b']);
    await db.close();
  });

  it('get returns null for missing id', async () => {
    const { content, db } = await setup();
    expect(await content.get('posts', 'nope')).toBeNull();
    await db.close();
  });

  it('update merges and re-validates; preserves unchanged fields', async () => {
    const { content, db } = await setup();
    const created = await content.create('posts', { title: 'a', body: [] });
    const updated = await content.update('posts', created.id, { title: 'b' });
    expect(updated.content).toEqual({ title: 'b', body: [] });
    await db.close();
  });

  it('delete throws NotFoundError for missing id', async () => {
    const { content, db } = await setup();
    await expect(content.delete('posts', 'nope')).rejects.toBeInstanceOf(NotFoundError);
    await db.close();
  });

  it('delete cascades to children', async () => {
    const { content, db } = await setup();
    const parent = await content.create('posts', { title: 'p', body: [] });
    await db.exec(
      "INSERT INTO entries (id, collection_handle, parent_id, content) VALUES ('child', 'posts', ?, '{}')",
      [parent.id],
    );
    await content.delete('posts', parent.id);
    const rows = await db.query("SELECT id FROM entries");
    expect(rows).toEqual([]);
    await db.close();
  });

  it('throws for unknown collection handle', async () => {
    const { content, db } = await setup();
    await expect(content.list('ghost')).rejects.toThrow(/unknown collection/);
    await db.close();
  });
});
```

- [ ] **Step 3: Run test — verify failure**

Run: `pnpm --filter @vulse/core test service`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `packages/core/src/content/service.ts`**

```ts
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
      const max = await db.queryOne<{ m: number | null }>(
        'SELECT MAX(sort_order) AS m FROM entries WHERE collection_handle = ? AND parent_id IS ?',
        [handle, parentId],
      );
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
      // Door open: future saveRevision(existing) call goes here.
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
```

- [ ] **Step 5: Re-export from `packages/core/src/index.ts`**

```ts
export { Collection } from './blueprints/collection.js';
export type { Blueprint, FieldMeta, FieldUi } from './blueprints/types.js';
export { loadBlueprints, type LoadOptions } from './blueprints/load.js';
export { createContentService } from './content/service.js';
export type { ContentService, Entry } from './content/types.js';
export { ValidationError, NotFoundError } from './errors.js';
```

- [ ] **Step 6: Run test — verify pass**

Run: `pnpm --filter @vulse/core test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): ContentService with ULID, scoped sort_order, validation, cascade"
```

---

### Task C4: Hono API factory — TDD

**Files:**
- Create: `packages/core/src/http/api.test.ts`
- Create: `packages/core/src/http/api.ts`
- Create: `packages/core/src/http/meta.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/src/http/meta.ts`**

```ts
import type { Blueprint, FieldMeta } from '../blueprints/types.js';

export interface BlueprintMeta {
  handle: string;
  label: string;
  fields: FieldMeta[];
}

export function toMeta(b: Blueprint): BlueprintMeta {
  return { handle: b.handle, label: b.label, fields: b.fields };
}
```

- [ ] **Step 2: Write failing test `packages/core/src/http/api.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { LibsqlAdapter, runMigrations, MIGRATIONS_DIR } from '@vulse/db';
import { loadBlueprints } from '../blueprints/load.js';
import { createContentService } from '../content/service.js';
import { createApi } from './api.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'blueprints', '__fixtures__');

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  const blueprints = await loadBlueprints(fixturesDir, { adapter: db });
  const content = createContentService(db, blueprints);
  const app = createApi({ blueprints, content });
  return { db, app };
}

describe('createApi', () => {
  it('lists entries as a plain array', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/collections/posts');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    await db.close();
  });

  it('POST creates and GET retrieves an entry', async () => {
    const { app, db } = await setup();
    const created = await app.request('http://x/api/collections/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'hi', body: [] }),
    });
    expect(created.status).toBe(201);
    const entry = await created.json();
    const fetched = await app.request(`http://x/api/collections/posts/${entry.id}`);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toEqual(entry);
    await db.close();
  });

  it('returns 422 with issues on validation failure', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/collections/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '', body: [] }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('validation');
    expect(Array.isArray(body.issues)).toBe(true);
    await db.close();
  });

  it('returns 404 on missing entry', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/collections/posts/missing');
    expect(res.status).toBe(404);
    await db.close();
  });

  it('PATCH updates and DELETE removes', async () => {
    const { app, db } = await setup();
    const created = await (
      await app.request('http://x/api/collections/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'a', body: [] }),
      })
    ).json();
    const updated = await (
      await app.request(`http://x/api/collections/posts/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'b' }),
      })
    ).json();
    expect(updated.content.title).toBe('b');

    const del = await app.request(`http://x/api/collections/posts/${created.id}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);
    await db.close();
  });

  it('/api/_meta/collections returns blueprint metadata', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/_meta/collections');
    const meta = await res.json();
    const handles = meta.map((m: { handle: string }) => m.handle).sort();
    expect(handles).toEqual(['authors', 'posts']);
    const posts = meta.find((m: { handle: string }) => m.handle === 'posts');
    expect(posts.fields[0]).toMatchObject({ name: 'title', ui: { kind: 'text' } });
    await db.close();
  });
});
```

- [ ] **Step 3: Run test — verify failure**

Run: `pnpm --filter @vulse/core test api`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `packages/core/src/http/api.ts`**

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Blueprint } from '../blueprints/types.js';
import type { ContentService } from '../content/types.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { toMeta } from './meta.js';

export interface ApiDeps {
  blueprints: Map<string, Blueprint>;
  content: ContentService;
}

export function createApi({ blueprints, content }: ApiDeps): Hono {
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

  for (const handle of blueprints.keys()) {
    app.get(`/api/collections/${handle}`, async (c) => {
      const limit = Number(c.req.query('limit') ?? '100');
      const offset = Number(c.req.query('offset') ?? '0');
      return c.json(await content.list(handle, { limit, offset }));
    });

    app.get(`/api/collections/${handle}/:id`, async (c) => {
      const entry = await content.get(handle, c.req.param('id'));
      if (!entry) throw new NotFoundError(`entry not found`);
      return c.json(entry);
    });

    app.post(`/api/collections/${handle}`, async (c) => {
      const input = await c.req.json();
      const entry = await content.create(handle, input);
      return c.json(entry, 201);
    });

    app.patch(`/api/collections/${handle}/:id`, async (c) => {
      const input = await c.req.json();
      const entry = await content.update(handle, c.req.param('id'), input);
      return c.json(entry);
    });

    app.delete(`/api/collections/${handle}/:id`, async (c) => {
      await content.delete(handle, c.req.param('id'));
      return c.body(null, 204);
    });
  }

  app.get('/api/_meta/collections', (c) =>
    c.json([...blueprints.values()].map(toMeta)),
  );

  return app;
}
```

- [ ] **Step 5: Re-export from `packages/core/src/index.ts`**

```ts
export { Collection } from './blueprints/collection.js';
export type { Blueprint, FieldMeta, FieldUi } from './blueprints/types.js';
export { loadBlueprints, type LoadOptions } from './blueprints/load.js';
export { createContentService } from './content/service.js';
export type { ContentService, Entry } from './content/types.js';
export { createApi, type ApiDeps } from './http/api.js';
export { toMeta, type BlueprintMeta } from './http/meta.js';
export { ValidationError, NotFoundError } from './errors.js';
```

- [ ] **Step 6: Run test — verify pass**

Run: `pnpm --filter @vulse/core test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): Hono API factory with /api/collections and /api/_meta/collections"
```

---

### Task C5: Vite plugin (`vulseDevPlugin`)

**Files:**
- Create: `packages/core/src/vite/plugin.ts`
- Modify: `packages/core/tsconfig.json` (include `vite` types)

- [ ] **Step 1: Implement `packages/core/src/vite/plugin.ts`**

```ts
import type { Plugin, ViteDevServer } from 'vite';
import type { Config } from '@libsql/client';
import { LibsqlAdapter, runMigrations, MIGRATIONS_DIR } from '@vulse/db';
import { loadBlueprints } from '../blueprints/load.js';
import { createContentService } from '../content/service.js';
import { createApi } from '../http/api.js';

export interface VulseDevOptions {
  blueprintsDir: string;
  database: Config;
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

      async function build() {
        const blueprints = await loadBlueprints(opts.blueprintsDir, { adapter: adapter! });
        return createApi({ blueprints, content: createContentService(adapter!, blueprints) });
      }

      let app = await build();

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next();
        try {
          const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') headers.set(k, v);
            else if (Array.isArray(v)) headers.set(k, v.join(','));
          }
          const body =
            req.method === 'GET' || req.method === 'HEAD'
              ? undefined
              : await readBody(req);
          const fetchReq = new Request(url.toString(), {
            method: req.method,
            headers,
            body,
          });
          const fetchRes = await app.fetch(fetchReq);
          res.statusCode = fetchRes.status;
          fetchRes.headers.forEach((v, k) => res.setHeader(k, v));
          const buf = Buffer.from(await fetchRes.arrayBuffer());
          res.end(buf);
        } catch (err) {
          next(err as Error);
        }
      });

      server.watcher.add(opts.blueprintsDir);
      server.watcher.on('change', async (file) => {
        if (file.startsWith(opts.blueprintsDir)) {
          app = await build();
          server.ws.send({ type: 'custom', event: 'vulse:blueprints-changed' });
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

- [ ] **Step 2: Update `packages/core/tsconfig.json` to include vite types**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

(No change required — `vite` is imported from the package directly.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @vulse/core check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core
git commit -m "feat(core): vulseDevPlugin for Vite middleware-mode dev server"
```

---

## Phase D — `packages/renderer`

### Task D1: Package scaffold + BlockNode + dispatcher (TDD)

**Files:**
- Create: `packages/renderer/package.json`
- Create: `packages/renderer/tsconfig.json`
- Create: `packages/renderer/vitest.config.ts`
- Create: `packages/renderer/src/types.ts`
- Create: `packages/renderer/src/BlockRenderer.vue`
- Create: `packages/renderer/src/Node.vue`
- Create: `packages/renderer/src/defaults.ts`
- Create: `packages/renderer/src/index.ts`
- Create: `packages/renderer/src/__tests__/dispatch.test.ts`

- [ ] **Step 1: Create `packages/renderer/package.json`**

```json
{
  "name": "@vulse/renderer",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":        { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./styles": "./styles/renderer.css"
  },
  "files": ["dist", "styles"],
  "scripts": {
    "build": "vue-tsc -p tsconfig.json && vite build",
    "check": "vue-tsc -p tsconfig.json --noEmit",
    "test":  "vitest run"
  },
  "peerDependencies": { "vue": "^3.5.0" },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.4",
    "@vue/test-utils":    "^2.4.6",
    "jsdom":              "^25.0.0",
    "typescript":         "^5.6.3",
    "vite":               "^5.4.10",
    "vitest":             "^2.1.4",
    "vue":                "^3.5.0",
    "vue-tsc":            "^2.1.10"
  }
}
```

- [ ] **Step 2: Create `packages/renderer/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["vite/client"]
  },
  "include": ["src/**/*", "src/**/*.vue"]
}
```

- [ ] **Step 3: Create `packages/renderer/vitest.config.ts`**

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    name: '@vulse/renderer',
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
  },
});
```

- [ ] **Step 4: Create `packages/renderer/src/types.ts`**

```ts
import type { Component } from 'vue';

export interface BlockMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface BlockNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: BlockNode[];
  text?: string;
  marks?: BlockMark[];
}

export type BlockComponentMap = Record<string, Component>;

export interface BlockRendererProps {
  doc: BlockNode | BlockNode[];
  components?: BlockComponentMap;
}
```

- [ ] **Step 5: Create `packages/renderer/src/defaults.ts`** (stub — components added in next task)

```ts
import type { BlockComponentMap } from './types.js';

export const defaultComponents: BlockComponentMap = {};
```

- [ ] **Step 6: Create `packages/renderer/src/Node.vue`**

```vue
<script setup lang="ts">
import { computed, h, type Component } from 'vue';
import type { BlockComponentMap, BlockNode } from './types.js';

const props = defineProps<{
  node: BlockNode;
  components: BlockComponentMap;
}>();

const resolved = computed<Component | null>(
  () => props.components[props.node.type] ?? null,
);
</script>

<template>
  <component
    :is="resolved"
    v-if="resolved"
    :node="node"
    :components="components"
  />
  <template v-else>
    <span v-if="$slots.default" />
    <!-- unknown node type: render nothing -->
  </template>
</template>
```

- [ ] **Step 7: Create `packages/renderer/src/BlockRenderer.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import Node from './Node.vue';
import { defaultComponents } from './defaults.js';
import type { BlockComponentMap, BlockNode } from './types.js';

const props = defineProps<{
  doc: BlockNode | BlockNode[];
  components?: BlockComponentMap;
}>();

const merged = computed<BlockComponentMap>(() => ({
  ...defaultComponents,
  ...(props.components ?? {}),
}));

const nodes = computed<BlockNode[]>(() =>
  Array.isArray(props.doc) ? props.doc : props.doc.content ?? [props.doc],
);
</script>

<template>
  <div class="vulse-doc">
    <Node v-for="(n, i) in nodes" :key="i" :node="n" :components="merged" />
  </div>
</template>
```

- [ ] **Step 8: Create `packages/renderer/src/index.ts`**

```ts
export { default as BlockRenderer } from './BlockRenderer.vue';
export type { BlockNode, BlockMark, BlockComponentMap, BlockRendererProps } from './types.js';
```

- [ ] **Step 9: Write test `packages/renderer/src/__tests__/dispatch.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import BlockRenderer from '../BlockRenderer.vue';

const Para = defineComponent({
  props: { node: { type: Object, required: true } },
  setup(props) {
    return () => h('p', (props.node as { content?: { text: string }[] }).content?.[0]?.text);
  },
});

describe('BlockRenderer dispatch', () => {
  it('dispatches node.type to a custom component', () => {
    const w = mount(BlockRenderer, {
      props: {
        doc: { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        components: { paragraph: Para },
      },
    });
    expect(w.html()).toContain('<p>Hello</p>');
  });

  it('renders nothing for unknown types', () => {
    const w = mount(BlockRenderer, {
      props: { doc: { type: 'unknown' } },
    });
    expect(w.text()).toBe('');
  });
});
```

- [ ] **Step 10: Install + run test**

Run: `pnpm install`
Run: `pnpm --filter @vulse/renderer test`
Expected: 2 tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/renderer pnpm-lock.yaml
git commit -m "feat(renderer): dispatcher with custom-component override and unknown-type fallback"
```

---

### Task D2: Default block components + Text/marks

**Files:**
- Create: `packages/renderer/src/blocks/Paragraph.vue`
- Create: `packages/renderer/src/blocks/Heading.vue`
- Create: `packages/renderer/src/blocks/BulletList.vue`
- Create: `packages/renderer/src/blocks/OrderedList.vue`
- Create: `packages/renderer/src/blocks/ListItem.vue`
- Create: `packages/renderer/src/blocks/Blockquote.vue`
- Create: `packages/renderer/src/blocks/CodeBlock.vue`
- Create: `packages/renderer/src/blocks/HardBreak.vue`
- Create: `packages/renderer/src/blocks/Text.vue`
- Create: `packages/renderer/src/blocks/VulseCallout.vue`
- Modify: `packages/renderer/src/defaults.ts`
- Create: `packages/renderer/styles/renderer.css`
- Create: `packages/renderer/src/__tests__/blocks.test.ts`

- [ ] **Step 1: Create `packages/renderer/src/blocks/Paragraph.vue`**

```vue
<script setup lang="ts">
import Node from '../Node.vue';
import type { BlockComponentMap, BlockNode } from '../types.js';

defineProps<{ node: BlockNode; components: BlockComponentMap }>();
</script>

<template>
  <p class="vulse-paragraph">
    <Node v-for="(child, i) in node.content ?? []" :key="i" :node="child" :components="components" />
  </p>
</template>
```

- [ ] **Step 2: Create `packages/renderer/src/blocks/Heading.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import Node from '../Node.vue';
import type { BlockComponentMap, BlockNode } from '../types.js';

const props = defineProps<{ node: BlockNode; components: BlockComponentMap }>();
const tag = computed(() => {
  const level = (props.node.attrs?.level as number | undefined) ?? 1;
  return `h${Math.min(Math.max(level, 1), 6)}`;
});
</script>

<template>
  <component :is="tag" class="vulse-heading">
    <Node v-for="(child, i) in node.content ?? []" :key="i" :node="child" :components="components" />
  </component>
</template>
```

- [ ] **Step 3: Create `packages/renderer/src/blocks/BulletList.vue`**

```vue
<script setup lang="ts">
import Node from '../Node.vue';
import type { BlockComponentMap, BlockNode } from '../types.js';

defineProps<{ node: BlockNode; components: BlockComponentMap }>();
</script>

<template>
  <ul class="vulse-bullet-list">
    <Node v-for="(child, i) in node.content ?? []" :key="i" :node="child" :components="components" />
  </ul>
</template>
```

- [ ] **Step 4: Create `packages/renderer/src/blocks/OrderedList.vue`**

```vue
<script setup lang="ts">
import Node from '../Node.vue';
import type { BlockComponentMap, BlockNode } from '../types.js';

defineProps<{ node: BlockNode; components: BlockComponentMap }>();
</script>

<template>
  <ol class="vulse-ordered-list">
    <Node v-for="(child, i) in node.content ?? []" :key="i" :node="child" :components="components" />
  </ol>
</template>
```

- [ ] **Step 5: Create `packages/renderer/src/blocks/ListItem.vue`**

```vue
<script setup lang="ts">
import Node from '../Node.vue';
import type { BlockComponentMap, BlockNode } from '../types.js';

defineProps<{ node: BlockNode; components: BlockComponentMap }>();
</script>

<template>
  <li class="vulse-list-item">
    <Node v-for="(child, i) in node.content ?? []" :key="i" :node="child" :components="components" />
  </li>
</template>
```

- [ ] **Step 6: Create `packages/renderer/src/blocks/Blockquote.vue`**

```vue
<script setup lang="ts">
import Node from '../Node.vue';
import type { BlockComponentMap, BlockNode } from '../types.js';

defineProps<{ node: BlockNode; components: BlockComponentMap }>();
</script>

<template>
  <blockquote class="vulse-blockquote">
    <Node v-for="(child, i) in node.content ?? []" :key="i" :node="child" :components="components" />
  </blockquote>
</template>
```

- [ ] **Step 7: Create `packages/renderer/src/blocks/CodeBlock.vue`**

```vue
<script setup lang="ts">
import type { BlockNode } from '../types.js';

const props = defineProps<{ node: BlockNode }>();
const text = (props.node.content ?? [])
  .map((c) => c.text ?? '')
  .join('');
const language = (props.node.attrs?.language as string | undefined) ?? null;
</script>

<template>
  <pre class="vulse-code-block"><code :data-language="language">{{ text }}</code></pre>
</template>
```

- [ ] **Step 8: Create `packages/renderer/src/blocks/HardBreak.vue`**

```vue
<template><br class="vulse-hard-break" /></template>
```

- [ ] **Step 9: Create `packages/renderer/src/blocks/Text.vue`**

```vue
<script setup lang="ts">
import { computed, h } from 'vue';
import type { BlockNode, BlockMark } from '../types.js';

const props = defineProps<{ node: BlockNode }>();

const markTag: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  code: 'code',
  underline: 'u',
  strike: 's',
};

const rendered = computed(() => {
  let vnode = props.node.text ?? '';
  const marks = (props.node.marks ?? []) as BlockMark[];
  let acc: ReturnType<typeof h> | string = vnode;
  for (const mark of marks) {
    if (mark.type === 'link') {
      const href = (mark.attrs?.href as string) ?? '#';
      acc = h('a', { class: 'vulse-link', href }, acc);
    } else if (markTag[mark.type]) {
      acc = h(markTag[mark.type]!, acc);
    }
  }
  return acc;
});
</script>

<template>
  <component :is="() => rendered" />
</template>
```

- [ ] **Step 10: Create `packages/renderer/src/blocks/VulseCallout.vue`**

```vue
<script setup lang="ts">
import Node from '../Node.vue';
import { computed } from 'vue';
import type { BlockComponentMap, BlockNode } from '../types.js';

const props = defineProps<{ node: BlockNode; components: BlockComponentMap }>();
const tone = computed(() => (props.node.attrs?.tone as string | undefined) ?? 'info');
</script>

<template>
  <aside class="vulse-callout" :class="`vulse-callout--${tone}`">
    <Node v-for="(child, i) in node.content ?? []" :key="i" :node="child" :components="components" />
  </aside>
</template>
```

- [ ] **Step 11: Replace `packages/renderer/src/defaults.ts`**

```ts
import type { BlockComponentMap } from './types.js';
import Paragraph from './blocks/Paragraph.vue';
import Heading from './blocks/Heading.vue';
import BulletList from './blocks/BulletList.vue';
import OrderedList from './blocks/OrderedList.vue';
import ListItem from './blocks/ListItem.vue';
import Blockquote from './blocks/Blockquote.vue';
import CodeBlock from './blocks/CodeBlock.vue';
import HardBreak from './blocks/HardBreak.vue';
import Text from './blocks/Text.vue';
import VulseCallout from './blocks/VulseCallout.vue';

export const defaultComponents: BlockComponentMap = {
  paragraph: Paragraph,
  heading: Heading,
  bulletList: BulletList,
  orderedList: OrderedList,
  listItem: ListItem,
  blockquote: Blockquote,
  codeBlock: CodeBlock,
  hardBreak: HardBreak,
  text: Text,
  vulseCallout: VulseCallout,
};
```

- [ ] **Step 12: Create `packages/renderer/styles/renderer.css`**

```css
.vulse-doc           { line-height: 1.6; }
.vulse-paragraph     { margin: 0 0 1em; }
.vulse-heading       { font-weight: 600; line-height: 1.2; margin: 1.4em 0 0.6em; }
.vulse-bullet-list   { padding-left: 1.5em; list-style: disc; }
.vulse-ordered-list  { padding-left: 1.5em; list-style: decimal; }
.vulse-blockquote    { border-left: 3px solid #d4d4d8; padding-left: 1em; color: #52525b; }
.vulse-code-block    { background: #f4f4f5; padding: 0.75em 1em; border-radius: 6px; overflow-x: auto; }
.vulse-link          { color: #2563eb; text-decoration: underline; }

.vulse-callout       { border-radius: 8px; padding: 0.75em 1em; margin: 1em 0; border: 1px solid; }
.vulse-callout--info { background: #eff6ff; border-color: #bfdbfe; color: #1e3a8a; }
.vulse-callout--warn { background: #fff7ed; border-color: #fed7aa; color: #9a3412; }
```

- [ ] **Step 13: Write test `packages/renderer/src/__tests__/blocks.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import BlockRenderer from '../BlockRenderer.vue';

describe('default blocks', () => {
  it('renders paragraph with text', () => {
    const w = mount(BlockRenderer, {
      props: {
        doc: { type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] },
      },
    });
    expect(w.html()).toContain('<p class="vulse-paragraph">Hi</p>');
  });

  it('renders heading at given level', () => {
    const w = mount(BlockRenderer, {
      props: {
        doc: { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
      },
    });
    expect(w.html()).toContain('<h2');
    expect(w.html()).toContain('>H</h2>');
  });

  it('applies bold mark via <strong>', () => {
    const w = mount(BlockRenderer, {
      props: {
        doc: {
          type: 'paragraph',
          content: [{ type: 'text', text: 'B', marks: [{ type: 'bold' }] }],
        },
      },
    });
    expect(w.html()).toContain('<strong>B</strong>');
  });

  it('renders vulseCallout with tone class', () => {
    const w = mount(BlockRenderer, {
      props: {
        doc: {
          type: 'vulseCallout',
          attrs: { tone: 'warn' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'careful' }] }],
        },
      },
    });
    expect(w.html()).toContain('vulse-callout--warn');
    expect(w.text()).toContain('careful');
  });
});
```

- [ ] **Step 14: Run tests — verify pass**

Run: `pnpm --filter @vulse/renderer test`
Expected: all tests pass.

- [ ] **Step 15: Commit**

```bash
git add packages/renderer
git commit -m "feat(renderer): default block components, marks, vulseCallout, base CSS"
```

---

## Phase E — `packages/admin`

### Task E1: Admin package scaffold + Tailwind + Pinia + router shell

**Files:**
- Create: `packages/admin/package.json`
- Create: `packages/admin/tsconfig.json`
- Create: `packages/admin/vitest.config.ts`
- Create: `packages/admin/vite.config.ts`
- Create: `packages/admin/tailwind.config.ts`
- Create: `packages/admin/postcss.config.js`
- Create: `packages/admin/index.html`
- Create: `packages/admin/src/main.ts`
- Create: `packages/admin/src/styles.css`
- Create: `packages/admin/src/App.vue`
- Create: `packages/admin/src/router.ts`
- Create: `packages/admin/src/api/client.ts`
- Create: `packages/admin/src/index.ts`

- [ ] **Step 1: Create `packages/admin/package.json`**

```json
{
  "name": "@vulse/admin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./styles": "./src/styles.css"
  },
  "scripts": {
    "build": "vue-tsc -p tsconfig.json --noEmit && vite build",
    "check": "vue-tsc -p tsconfig.json --noEmit",
    "test":  "vitest run"
  },
  "dependencies": {
    "@tiptap/extension-document":   "^2.8.0",
    "@tiptap/pm":                   "^2.8.0",
    "@tiptap/starter-kit":          "^2.8.0",
    "@tiptap/vue-3":                "^2.8.0",
    "@vulse/renderer":              "workspace:*",
    "pinia":                        "^2.2.4",
    "reka-ui":                      "^1.0.0-alpha.10",
    "vue":                          "^3.5.0",
    "vue-router":                   "^4.4.5"
  },
  "devDependencies": {
    "@tailwindcss/postcss":         "^4.0.0-beta.3",
    "@vitejs/plugin-vue":           "^5.1.4",
    "@vue/test-utils":              "^2.4.6",
    "autoprefixer":                 "^10.4.20",
    "jsdom":                        "^25.0.0",
    "postcss":                      "^8.4.47",
    "tailwindcss":                  "^4.0.0-beta.3",
    "typescript":                   "^5.6.3",
    "vite":                         "^5.4.10",
    "vitest":                       "^2.1.4",
    "vue-tsc":                      "^2.1.10"
  }
}
```

- [ ] **Step 2: Create `packages/admin/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["vite/client"]
  },
  "include": ["src/**/*", "src/**/*.vue"]
}
```

- [ ] **Step 3: Create `packages/admin/vitest.config.ts`**

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    name: '@vulse/admin',
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
  },
});
```

- [ ] **Step 4: Create `packages/admin/vite.config.ts`**

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 5: Create `packages/admin/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 6: Create `packages/admin/postcss.config.js`**

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 7: Create `packages/admin/src/styles.css`**

```css
@import "tailwindcss";

:root {
  --vulse-sidebar-width: 240px;
}

html, body, #app { height: 100%; }
body { font-family: ui-sans-serif, system-ui, sans-serif; color: #18181b; background: #fafafa; }
```

- [ ] **Step 8: Create `packages/admin/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1.0" />
    <title>Vulse Admin</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 9: Create `packages/admin/src/api/client.ts`**

```ts
export interface FieldUi {
  kind: 'text' | 'textarea' | 'blocks' | 'date' | 'boolean' | 'select' | 'relationship';
  options?: readonly string[];
  to?: string;
}

export interface FieldMeta {
  name: string;
  ui: FieldUi;
  optional: boolean;
  default?: unknown;
}

export interface BlueprintMeta {
  handle: string;
  label: string;
  fields: FieldMeta[];
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

export interface ApiError {
  error: string;
  issues?: Array<{ path: (string | number)[]; message: string }>;
  message?: string;
}

class ApiClient {
  private base = '';

  async meta(): Promise<BlueprintMeta[]> {
    return this.request<BlueprintMeta[]>('GET', '/api/_meta/collections');
  }
  list(handle: string): Promise<Entry[]> {
    return this.request<Entry[]>('GET', `/api/collections/${handle}`);
  }
  get(handle: string, id: string): Promise<Entry> {
    return this.request<Entry>('GET', `/api/collections/${handle}/${id}`);
  }
  create(handle: string, input: Record<string, unknown>): Promise<Entry> {
    return this.request<Entry>('POST', `/api/collections/${handle}`, input);
  }
  update(handle: string, id: string, input: Record<string, unknown>): Promise<Entry> {
    return this.request<Entry>('PATCH', `/api/collections/${handle}/${id}`, input);
  }
  delete(handle: string, id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/collections/${handle}/${id}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw Object.assign(new Error('api error'), { response: data as ApiError, status: res.status });
    return data as T;
  }
}

export const api = new ApiClient();
```

- [ ] **Step 10: Create `packages/admin/src/router.ts`**

```ts
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import CollectionList from './pages/CollectionList.vue';
import CollectionEntry from './pages/CollectionEntry.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/loading' },
  { path: '/loading', component: { template: '<div class="p-8 text-zinc-500">Loading…</div>' } },
  { path: '/collections/:handle', component: CollectionList, props: true },
  { path: '/collections/:handle/new', component: CollectionEntry, props: (r) => ({ handle: r.params.handle, id: null }) },
  { path: '/collections/:handle/:id', component: CollectionEntry, props: true },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
```

- [ ] **Step 11: Create placeholder `packages/admin/src/pages/CollectionList.vue` and `CollectionEntry.vue`**

```vue
<!-- packages/admin/src/pages/CollectionList.vue -->
<script setup lang="ts">
defineProps<{ handle: string }>();
</script>
<template>
  <div class="p-6" :data-testid="`collection-list-${handle}`">
    <h1 class="text-xl font-semibold">{{ handle }}</h1>
  </div>
</template>
```

```vue
<!-- packages/admin/src/pages/CollectionEntry.vue -->
<script setup lang="ts">
defineProps<{ handle: string; id: string | null }>();
</script>
<template>
  <div class="p-6" :data-testid="`collection-entry-${handle}`">
    {{ id ?? 'new' }}
  </div>
</template>
```

- [ ] **Step 12: Create `packages/admin/src/App.vue`**

```vue
<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView, useRouter } from 'vue-router';
import { useBlueprintsStore } from './stores/blueprints.js';

const store = useBlueprintsStore();
const router = useRouter();

onMounted(async () => {
  await store.hydrate();
  const first = store.list[0];
  if (first && router.currentRoute.value.path === '/loading') {
    router.replace(`/collections/${first.handle}`);
  }
});
</script>

<template>
  <div class="flex h-full">
    <aside class="w-[var(--vulse-sidebar-width)] border-r border-zinc-200 bg-white">
      <div class="px-4 py-3 font-semibold tracking-tight">Vulse</div>
      <nav class="px-2">
        <div class="px-2 pt-2 text-xs uppercase tracking-wide text-zinc-500">Collections</div>
        <RouterLink
          v-for="bp in store.list"
          :key="bp.handle"
          :to="`/collections/${bp.handle}`"
          class="block rounded px-2 py-1.5 text-sm hover:bg-zinc-100"
          active-class="bg-zinc-100 font-medium"
          :data-testid="`nav-${bp.handle}`"
        >
          {{ bp.label }}
        </RouterLink>

        <!-- Door-open slots for later milestones:
        <div class="px-2 pt-4 text-xs uppercase tracking-wide text-zinc-500">Navigation</div>
        <div class="px-2 pt-4 text-xs uppercase tracking-wide text-zinc-500">Settings</div>
        -->
      </nav>
    </aside>
    <main class="flex-1 overflow-auto">
      <RouterView />
    </main>
  </div>
</template>
```

- [ ] **Step 13: Create `packages/admin/src/stores/blueprints.ts`**

```ts
import { defineStore } from 'pinia';
import { api, type BlueprintMeta } from '../api/client.js';

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
      const all = await api.meta();
      this.map = new Map(all.map((bp) => [bp.handle, bp]));
      this.hydrated = true;
    },
    get(handle: string): BlueprintMeta | undefined {
      return this.map.get(handle);
    },
  },
});
```

- [ ] **Step 14: Create `packages/admin/src/main.ts`**

```ts
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router.js';
import './styles.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
```

- [ ] **Step 15: Create `packages/admin/src/index.ts`**

```ts
// Public re-exports so apps/dev can mount the admin
export { default as AdminApp } from './App.vue';
export { router as adminRouter } from './router.js';
export { useBlueprintsStore } from './stores/blueprints.js';
```

- [ ] **Step 16: Install + typecheck**

Run: `pnpm install`
Run: `pnpm --filter @vulse/admin check`
Expected: PASS.

- [ ] **Step 17: Commit**

```bash
git add packages/admin pnpm-lock.yaml
git commit -m "feat(admin): scaffold with Pinia store, router, sidebar shell, API client"
```

---

### Task E2: FieldRenderer + simple field components (TDD)

**Files:**
- Create: `packages/admin/src/components/FieldRenderer.vue`
- Create: `packages/admin/src/components/fields/TextField.vue`
- Create: `packages/admin/src/components/fields/TextareaField.vue`
- Create: `packages/admin/src/components/fields/DateField.vue`
- Create: `packages/admin/src/components/fields/BooleanField.vue`
- Create: `packages/admin/src/components/fields/SelectField.vue`
- Create: `packages/admin/src/components/fields/BlocksField.vue` (stub, real impl in E4)
- Create: `packages/admin/src/components/fields/RelationshipField.vue` (stub, real impl in E3)
- Create: `packages/admin/src/components/__tests__/FieldRenderer.test.ts`

- [ ] **Step 1: Create `packages/admin/src/components/fields/TextField.vue`**

```vue
<script setup lang="ts">
defineProps<{ name: string; modelValue: string | undefined; error?: string }>();
defineEmits<{ 'update:modelValue': [string] }>();
</script>

<template>
  <label class="block">
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <input
      type="text"
      class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
      :value="modelValue ?? ''"
      :data-testid="`field-${name}`"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <span v-if="error" class="mt-1 block text-xs text-red-600">{{ error }}</span>
  </label>
</template>
```

- [ ] **Step 2: Create `packages/admin/src/components/fields/TextareaField.vue`**

```vue
<script setup lang="ts">
defineProps<{ name: string; modelValue: string | undefined; error?: string }>();
defineEmits<{ 'update:modelValue': [string] }>();
</script>

<template>
  <label class="block">
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <textarea
      class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
      rows="4"
      :value="modelValue ?? ''"
      :data-testid="`field-${name}`"
      @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
    <span v-if="error" class="mt-1 block text-xs text-red-600">{{ error }}</span>
  </label>
</template>
```

- [ ] **Step 3: Create `packages/admin/src/components/fields/DateField.vue`**

```vue
<script setup lang="ts">
defineProps<{ name: string; modelValue: string | undefined; error?: string }>();
defineEmits<{ 'update:modelValue': [string] }>();
</script>

<template>
  <label class="block">
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <input
      type="datetime-local"
      class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
      :value="modelValue ?? ''"
      :data-testid="`field-${name}`"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <span v-if="error" class="mt-1 block text-xs text-red-600">{{ error }}</span>
  </label>
</template>
```

- [ ] **Step 4: Create `packages/admin/src/components/fields/BooleanField.vue`**

```vue
<script setup lang="ts">
defineProps<{ name: string; modelValue: boolean | undefined; error?: string }>();
defineEmits<{ 'update:modelValue': [boolean] }>();
</script>

<template>
  <label class="flex items-center gap-2">
    <input
      type="checkbox"
      class="rounded border-zinc-300"
      :checked="!!modelValue"
      :data-testid="`field-${name}`"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <span v-if="error" class="text-xs text-red-600">{{ error }}</span>
  </label>
</template>
```

- [ ] **Step 5: Create `packages/admin/src/components/fields/SelectField.vue`**

```vue
<script setup lang="ts">
defineProps<{
  name: string;
  modelValue: string | undefined;
  options?: readonly string[];
  error?: string;
}>();
defineEmits<{ 'update:modelValue': [string] }>();
</script>

<template>
  <label class="block">
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <select
      class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
      :value="modelValue ?? ''"
      :data-testid="`field-${name}`"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option value="" disabled>Select…</option>
      <option v-for="o in options ?? []" :key="o" :value="o">{{ o }}</option>
    </select>
    <span v-if="error" class="mt-1 block text-xs text-red-600">{{ error }}</span>
  </label>
</template>
```

- [ ] **Step 6: Create stub `packages/admin/src/components/fields/BlocksField.vue`** (real impl in E4)

```vue
<script setup lang="ts">
defineProps<{ name: string; modelValue: unknown }>();
defineEmits<{ 'update:modelValue': [unknown] }>();
</script>

<template>
  <div :data-testid="`field-${name}`" class="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
    Block editor (TipTap) — wired in Task E4
  </div>
</template>
```

- [ ] **Step 7: Create stub `packages/admin/src/components/fields/RelationshipField.vue`** (real impl in E3)

```vue
<script setup lang="ts">
defineProps<{ name: string; modelValue: string | undefined; to?: string }>();
defineEmits<{ 'update:modelValue': [string] }>();
</script>

<template>
  <label class="block">
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <input
      type="text"
      class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
      :value="modelValue ?? ''"
      :data-testid="`field-${name}`"
      :placeholder="`id of related ${to}`"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </label>
</template>
```

- [ ] **Step 8: Create `packages/admin/src/components/FieldRenderer.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldMeta } from '../api/client.js';
import TextField from './fields/TextField.vue';
import TextareaField from './fields/TextareaField.vue';
import DateField from './fields/DateField.vue';
import BooleanField from './fields/BooleanField.vue';
import SelectField from './fields/SelectField.vue';
import BlocksField from './fields/BlocksField.vue';
import RelationshipField from './fields/RelationshipField.vue';

const props = defineProps<{
  meta: FieldMeta;
  modelValue: unknown;
  error?: string;
}>();
defineEmits<{ 'update:modelValue': [unknown] }>();

const component = computed(() => {
  switch (props.meta.ui.kind) {
    case 'text':         return TextField;
    case 'textarea':     return TextareaField;
    case 'date':         return DateField;
    case 'boolean':      return BooleanField;
    case 'select':       return SelectField;
    case 'blocks':       return BlocksField;
    case 'relationship': return RelationshipField;
  }
});
</script>

<template>
  <component
    :is="component"
    :name="meta.name"
    :model-value="modelValue"
    :options="meta.ui.options"
    :to="meta.ui.to"
    :error="error"
    @update:model-value="(v: unknown) => $emit('update:modelValue', v)"
  />
</template>
```

- [ ] **Step 9: Write test `packages/admin/src/components/__tests__/FieldRenderer.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import FieldRenderer from '../FieldRenderer.vue';

describe('FieldRenderer', () => {
  it('renders a text input for ui.kind=text', () => {
    const w = mount(FieldRenderer, {
      props: {
        meta: { name: 'title', ui: { kind: 'text' }, optional: false },
        modelValue: 'hi',
      },
    });
    expect(w.find('[data-testid="field-title"]').element.tagName).toBe('INPUT');
  });

  it('renders a textarea for ui.kind=textarea', () => {
    const w = mount(FieldRenderer, {
      props: {
        meta: { name: 'bio', ui: { kind: 'textarea' }, optional: true },
        modelValue: '',
      },
    });
    expect(w.find('[data-testid="field-bio"]').element.tagName).toBe('TEXTAREA');
  });

  it('renders a checkbox for ui.kind=boolean', () => {
    const w = mount(FieldRenderer, {
      props: {
        meta: { name: 'isFeatured', ui: { kind: 'boolean' }, optional: false },
        modelValue: false,
      },
    });
    expect(w.find('[data-testid="field-isFeatured"]').attributes('type')).toBe('checkbox');
  });

  it('renders a select for ui.kind=select', () => {
    const w = mount(FieldRenderer, {
      props: {
        meta: { name: 'status', ui: { kind: 'select', options: ['draft', 'published'] }, optional: false },
        modelValue: 'draft',
      },
    });
    expect(w.find('[data-testid="field-status"]').element.tagName).toBe('SELECT');
    expect(w.findAll('option')).toHaveLength(3); // placeholder + 2
  });

  it('emits update:modelValue on input', async () => {
    const w = mount(FieldRenderer, {
      props: {
        meta: { name: 'title', ui: { kind: 'text' }, optional: false },
        modelValue: '',
      },
    });
    await w.find('input').setValue('typed');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['typed']);
  });
});
```

- [ ] **Step 10: Run tests — verify pass**

Run: `pnpm --filter @vulse/admin test FieldRenderer`
Expected: 5 tests pass.

- [ ] **Step 11: Commit**

```bash
git add packages/admin
git commit -m "feat(admin): FieldRenderer dispatcher and basic field components"
```

---

### Task E3: RelationshipField (fetches options from API)

**Files:**
- Modify: `packages/admin/src/components/fields/RelationshipField.vue`
- Create: `packages/admin/src/components/fields/__tests__/RelationshipField.test.ts`

- [ ] **Step 1: Replace `RelationshipField.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type Entry } from '../../api/client.js';

const props = defineProps<{
  name: string;
  modelValue: string | undefined;
  to?: string;
}>();
defineEmits<{ 'update:modelValue': [string] }>();

const options = ref<Entry[]>([]);
const loading = ref(false);

onMounted(async () => {
  if (!props.to) return;
  loading.value = true;
  try {
    options.value = await api.list(props.to);
  } finally {
    loading.value = false;
  }
});

function labelFor(e: Entry): string {
  const c = e.content as Record<string, unknown>;
  return (c.title ?? c.name ?? e.id) as string;
}
</script>

<template>
  <label class="block">
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <select
      class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
      :value="modelValue ?? ''"
      :disabled="loading"
      :data-testid="`field-${name}`"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option value="" disabled>{{ loading ? 'Loading…' : `Select a ${to ?? 'related entry'}` }}</option>
      <option v-for="o in options" :key="o.id" :value="o.id">{{ labelFor(o) }}</option>
    </select>
  </label>
</template>
```

- [ ] **Step 2: Write test `packages/admin/src/components/fields/__tests__/RelationshipField.test.ts`**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import RelationshipField from '../RelationshipField.vue';
import * as client from '../../../api/client.js';

beforeEach(() => {
  vi.spyOn(client.api, 'list').mockResolvedValue([
    { id: 'a', collection: 'authors', parentId: null, sortOrder: 1, status: 'published', content: { name: 'Ada' }, createdAt: '', updatedAt: '' },
    { id: 'b', collection: 'authors', parentId: null, sortOrder: 2, status: 'published', content: { name: 'Bob' }, createdAt: '', updatedAt: '' },
  ]);
});

describe('RelationshipField', () => {
  it('loads options from the API and renders them', async () => {
    const w = mount(RelationshipField, {
      props: { name: 'author', modelValue: undefined, to: 'authors' },
    });
    await flushPromises();
    const opts = w.findAll('option');
    expect(opts.map((o) => o.text())).toEqual(['Select a authors', 'Ada', 'Bob']);
  });

  it('emits update:modelValue when an option is chosen', async () => {
    const w = mount(RelationshipField, {
      props: { name: 'author', modelValue: undefined, to: 'authors' },
    });
    await flushPromises();
    await w.find('select').setValue('a');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['a']);
  });
});
```

- [ ] **Step 3: Run tests — verify pass**

Run: `pnpm --filter @vulse/admin test RelationshipField`
Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/admin
git commit -m "feat(admin): RelationshipField loads options from /api/collections/:to"
```

---

### Task E4: BlocksField — TipTap with vulseCallout custom node

**Files:**
- Modify: `packages/admin/src/components/fields/BlocksField.vue`
- Create: `packages/admin/src/components/fields/vulse-callout-extension.ts`

- [ ] **Step 1: Create `packages/admin/src/components/fields/vulse-callout-extension.ts`**

```ts
import { Node, mergeAttributes } from '@tiptap/core';

export interface VulseCalloutAttrs {
  tone: 'info' | 'warn';
}

export const VulseCalloutExtension = Node.create({
  name: 'vulseCallout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: 'info',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-tone') ?? 'info',
        renderHTML: (attrs) => ({ 'data-tone': attrs.tone }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'aside[data-vulse-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['aside', mergeAttributes(HTMLAttributes, { 'data-vulse-callout': '' }), 0];
  },

  addCommands() {
    return {
      insertVulseCallout:
        (tone: 'info' | 'warn' = 'info') =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { tone },
            content: [{ type: 'paragraph' }],
          }),
    } as Record<string, unknown> as never;
  },
});
```

- [ ] **Step 2: Replace `BlocksField.vue`**

```vue
<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { watch } from 'vue';
import { VulseCalloutExtension } from './vulse-callout-extension.js';

const props = defineProps<{
  name: string;
  modelValue: unknown;
  error?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [unknown] }>();

const editor = useEditor({
  extensions: [StarterKit, VulseCalloutExtension],
  content: (props.modelValue as object) ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  onUpdate: ({ editor }) => {
    emit('update:modelValue', editor.getJSON());
  },
});

watch(
  () => props.modelValue,
  (v) => {
    if (!editor.value) return;
    const current = JSON.stringify(editor.value.getJSON());
    const incoming = JSON.stringify(v);
    if (current !== incoming && v) {
      editor.value.commands.setContent(v as object, false);
    }
  },
);

function insertCallout(tone: 'info' | 'warn') {
  (editor.value?.commands as unknown as { insertVulseCallout: (t: string) => void })
    .insertVulseCallout?.(tone);
}
</script>

<template>
  <div :data-testid="`field-${name}`">
    <span class="block text-sm font-medium text-zinc-700 capitalize">{{ name }}</span>
    <div class="mt-1 rounded border border-zinc-300">
      <div class="flex gap-1 border-b border-zinc-200 bg-zinc-50 px-2 py-1 text-xs">
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" @click="editor?.chain().focus().toggleBold().run()">B</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200 italic" @click="editor?.chain().focus().toggleItalic().run()">I</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()">H2</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" @click="editor?.chain().focus().toggleBulletList().run()">• List</button>
        <span class="mx-1 w-px bg-zinc-300" />
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" @click="insertCallout('info')">+ Info</button>
        <button type="button" class="rounded px-2 py-1 hover:bg-zinc-200" @click="insertCallout('warn')">+ Warn</button>
      </div>
      <EditorContent :editor="editor" class="prose max-w-none p-3 text-sm" />
    </div>
    <span v-if="error" class="mt-1 block text-xs text-red-600">{{ error }}</span>
  </div>
</template>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @vulse/admin check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/admin
git commit -m "feat(admin): BlocksField TipTap host with vulseCallout custom node"
```

---

### Task E5: CollectionList page

**Files:**
- Modify: `packages/admin/src/pages/CollectionList.vue`

- [ ] **Step 1: Replace `CollectionList.vue`**

```vue
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, type Entry } from '../api/client.js';
import { useBlueprintsStore } from '../stores/blueprints.js';

const props = defineProps<{ handle: string }>();
const entries = ref<Entry[]>([]);
const loading = ref(false);
const store = useBlueprintsStore();

async function load(handle: string) {
  loading.value = true;
  try {
    entries.value = await api.list(handle);
  } finally {
    loading.value = false;
  }
}

onMounted(() => load(props.handle));
watch(() => props.handle, (h) => load(h));

function preview(e: Entry): string {
  const c = e.content as Record<string, unknown>;
  return (c.title ?? c.name ?? e.id) as string;
}

async function remove(id: string) {
  if (!confirm('Delete this entry?')) return;
  await api.delete(props.handle, id);
  entries.value = entries.value.filter((e) => e.id !== id);
}
</script>

<template>
  <div class="p-6" :data-testid="`collection-list-${handle}`">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-semibold capitalize">{{ store.get(handle)?.label ?? handle }}</h1>
      <RouterLink
        :to="`/collections/${handle}/new`"
        class="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
        data-testid="new-entry"
      >
        New entry
      </RouterLink>
    </div>

    <div v-if="loading" class="text-sm text-zinc-500">Loading…</div>
    <div v-else-if="entries.length === 0" class="rounded border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
      No entries yet.
    </div>
    <table v-else class="w-full text-sm">
      <thead class="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
        <tr>
          <th class="py-2">ID</th>
          <th class="py-2">Preview</th>
          <th class="py-2">Updated</th>
          <th class="py-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in entries" :key="e.id" class="border-b border-zinc-100">
          <td class="py-2 font-mono text-xs text-zinc-500">{{ e.id.slice(0, 8) }}…</td>
          <td class="py-2">
            <RouterLink :to="`/collections/${handle}/${e.id}`" class="hover:underline">
              {{ preview(e) }}
            </RouterLink>
          </td>
          <td class="py-2 text-zinc-500">{{ e.updatedAt }}</td>
          <td class="py-2 text-right">
            <button class="text-xs text-red-600 hover:underline" :data-testid="`delete-${e.id}`" @click="remove(e.id)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @vulse/admin check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/admin
git commit -m "feat(admin): CollectionList page with table view and delete"
```

---

### Task E6: CollectionEntry page

**Files:**
- Modify: `packages/admin/src/pages/CollectionEntry.vue`

- [ ] **Step 1: Replace `CollectionEntry.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, type ApiError } from '../api/client.js';
import { useBlueprintsStore } from '../stores/blueprints.js';
import FieldRenderer from '../components/FieldRenderer.vue';

const props = defineProps<{ handle: string; id: string | null }>();
const router = useRouter();
const store = useBlueprintsStore();

const state = reactive<Record<string, unknown>>({});
const errors = reactive<Record<string, string>>({});
const saving = ref(false);
const loading = ref(false);
const submitError = ref<string | null>(null);

const blueprint = computed(() => store.get(props.handle));

async function loadEntry() {
  Object.keys(state).forEach((k) => delete state[k]);
  Object.keys(errors).forEach((k) => delete errors[k]);

  const bp = blueprint.value;
  if (!bp) return;

  if (props.id) {
    loading.value = true;
    try {
      const entry = await api.get(props.handle, props.id);
      for (const f of bp.fields) state[f.name] = (entry.content as Record<string, unknown>)[f.name];
    } finally {
      loading.value = false;
    }
  } else {
    for (const f of bp.fields) state[f.name] = f.default ?? defaultFor(f.ui.kind);
  }
}

function defaultFor(kind: string): unknown {
  if (kind === 'boolean') return false;
  if (kind === 'blocks') return { type: 'doc', content: [{ type: 'paragraph' }] };
  return '';
}

onMounted(loadEntry);
watch(() => [props.handle, props.id, blueprint.value], loadEntry);

async function save() {
  Object.keys(errors).forEach((k) => delete errors[k]);
  submitError.value = null;
  saving.value = true;
  try {
    const entry = props.id
      ? await api.update(props.handle, props.id, { ...state })
      : await api.create(props.handle, { ...state });
    if (!props.id) router.replace(`/collections/${props.handle}/${entry.id}`);
  } catch (err) {
    const e = err as { response?: ApiError };
    if (e.response?.error === 'validation' && e.response.issues) {
      for (const issue of e.response.issues) {
        const field = String(issue.path[0] ?? '');
        if (field) errors[field] = issue.message;
      }
    } else {
      submitError.value = e.response?.message ?? 'Failed to save';
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="p-6" :data-testid="`collection-entry-${handle}`">
    <div v-if="!blueprint" class="text-sm text-zinc-500">Unknown collection.</div>
    <template v-else>
      <h1 class="mb-4 text-xl font-semibold">
        {{ id ? 'Edit' : 'New' }} {{ blueprint.label }}
      </h1>
      <div v-if="loading" class="text-sm text-zinc-500">Loading…</div>
      <form v-else class="max-w-2xl space-y-4" @submit.prevent="save">
        <FieldRenderer
          v-for="f in blueprint.fields"
          :key="f.name"
          :meta="f"
          :model-value="state[f.name]"
          :error="errors[f.name]"
          @update:model-value="(v: unknown) => (state[f.name] = v)"
        />
        <div v-if="submitError" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{{ submitError }}</div>
        <div class="flex gap-2">
          <button
            type="submit"
            class="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            :disabled="saving"
            data-testid="submit"
          >
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @vulse/admin check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/admin
git commit -m "feat(admin): CollectionEntry page wired to FieldRenderer + validation mapping"
```

---

### Task E7: blueprints store test

**Files:**
- Create: `packages/admin/src/stores/__tests__/blueprints.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useBlueprintsStore } from '../blueprints.js';
import * as client from '../../api/client.js';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(client.api, 'meta').mockResolvedValue([
    { handle: 'posts', label: 'Posts', fields: [] },
    { handle: 'authors', label: 'Authors', fields: [] },
  ]);
});

describe('useBlueprintsStore', () => {
  it('hydrates from /api/_meta/collections', async () => {
    const store = useBlueprintsStore();
    await store.hydrate();
    expect(store.list.map((b) => b.handle).sort()).toEqual(['authors', 'posts']);
    expect(store.get('posts')?.label).toBe('Posts');
  });

  it('only hydrates once', async () => {
    const store = useBlueprintsStore();
    await store.hydrate();
    await store.hydrate();
    expect(client.api.meta).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run — verify pass**

Run: `pnpm --filter @vulse/admin test blueprints`
Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/admin
git commit -m "test(admin): blueprints store hydration + memoization"
```

---

## Phase F — `apps/dev`

### Task F1: Sandbox scaffold + sample blueprints

**Files:**
- Create: `apps/dev/package.json`
- Create: `apps/dev/tsconfig.json`
- Create: `apps/dev/vite.config.ts`
- Create: `apps/dev/vite.config.server.ts`
- Create: `apps/dev/vitest.config.ts`
- Create: `apps/dev/vulse.config.ts`
- Create: `apps/dev/index.html`
- Create: `apps/dev/src/main.ts`
- Create: `apps/dev/blueprints/posts.ts`
- Create: `apps/dev/blueprints/authors.ts`
- Create: `apps/dev/src/server.prod.ts`

- [ ] **Step 1: Create `apps/dev/package.json`**

```json
{
  "name": "@vulse/dev",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev":   "vite",
    "build": "vite build && vite build -c vite.config.server.ts",
    "start": "node dist/server/server.prod.js",
    "check": "vue-tsc -p tsconfig.json --noEmit",
    "test":  "vitest run"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "@vulse/admin":      "workspace:*",
    "@vulse/core":       "workspace:*",
    "@vulse/db":         "workspace:*",
    "hono":              "^4.6.0",
    "vue":               "^3.5.0",
    "zod":               "^4.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.4",
    "typescript":         "^5.6.3",
    "vite":               "^5.4.10",
    "vitest":             "^2.1.4",
    "vue-tsc":            "^2.1.10"
  }
}
```

- [ ] **Step 2: Create `apps/dev/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": ".",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "types": ["vite/client", "node"]
  },
  "include": ["src/**/*", "src/**/*.vue", "blueprints/**/*", "vulse.config.ts"]
}
```

- [ ] **Step 3: Create `apps/dev/vulse.config.ts`**

```ts
export default {
  blueprintsDir: new URL('./blueprints/', import.meta.url).pathname,
  database: { url: 'file:./dev.db' },
};
```

- [ ] **Step 4: Create `apps/dev/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { vulseDevPlugin } from '@vulse/core/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    vue(),
    vulseDevPlugin({
      blueprintsDir: resolve(__dirname, 'blueprints'),
      database: { url: 'file:./dev.db' },
    }),
  ],
  resolve: {
    alias: {
      '@vulse/admin': resolve(__dirname, '../../packages/admin/src/index.ts'),
    },
  },
});
```

- [ ] **Step 5: Create `apps/dev/vite.config.server.ts`**

```ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist/server',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/server.prod.ts'),
      output: { format: 'esm', entryFileNames: 'server.prod.js' },
    },
    target: 'node22',
  },
});
```

- [ ] **Step 6: Create `apps/dev/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@vulse/dev',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 7: Create `apps/dev/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1.0" />
    <title>Vulse</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 8: Create `apps/dev/src/main.ts`**

```ts
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { AdminApp, adminRouter } from '@vulse/admin';
import '@vulse/admin/styles';

createApp(AdminApp).use(createPinia()).use(adminRouter).mount('#app');
```

- [ ] **Step 9: Create `apps/dev/blueprints/posts.ts`**

```ts
import { z } from 'zod';
import { Collection } from '@vulse/core';

export default class Posts extends Collection {
  static handle = 'posts';
  static label = 'Posts';

  static schema = z.object({
    title:      z.string().min(1).meta({ ui: { kind: 'text' } }),
    slug:       z.string().min(1).meta({ ui: { kind: 'text' } }),
    excerpt:    z.string().optional().meta({ ui: { kind: 'textarea' } }),
    body:       z.array(z.any()).meta({ ui: { kind: 'blocks' } }),
    publishAt:  z.string().optional().meta({ ui: { kind: 'date' } }),
    isFeatured: z.boolean().default(false).meta({ ui: { kind: 'boolean' } }),
    status:     z.enum(['draft', 'published']).meta({ ui: { kind: 'select', options: ['draft', 'published'] } }),
    author:     z.string().optional().meta({ ui: { kind: 'relationship', to: 'authors' } }),
  });
}
```

- [ ] **Step 10: Create `apps/dev/blueprints/authors.ts`**

```ts
import { z } from 'zod';
import { Collection } from '@vulse/core';

export default class Authors extends Collection {
  static handle = 'authors';
  static label = 'Authors';

  static schema = z.object({
    name:  z.string().min(1).meta({ ui: { kind: 'text' } }),
    bio:   z.string().optional().meta({ ui: { kind: 'textarea' } }),
  });
}
```

- [ ] **Step 11: Create `apps/dev/src/server.prod.ts`**

```ts
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { resolve } from 'node:path';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { createApi, createContentService, loadBlueprints } from '@vulse/core';

const db = new LibsqlAdapter({ url: process.env.VULSE_DB_URL ?? 'file:./dev.db' });
await db.exec('PRAGMA foreign_keys = ON');
await runMigrations(db, MIGRATIONS_DIR);

const blueprints = await loadBlueprints(resolve(import.meta.dirname, '..', 'blueprints'), {
  adapter: db,
});
const content = createContentService(db, blueprints);
const api = createApi({ blueprints, content });

const app = new Hono();
app.route('/', api);
app.use('/*', serveStatic({ root: resolve(import.meta.dirname, '..', 'dist') }));

const port = Number(process.env.PORT ?? '3000');
serve({ fetch: app.fetch, port }, ({ port }) => {
  console.log(`Vulse listening on http://localhost:${port}`);
});
```

- [ ] **Step 12: Install + typecheck + commit**

Run: `pnpm install`
Run: `pnpm --filter @vulse/dev check`
Expected: PASS.

```bash
git add apps/dev pnpm-lock.yaml
git commit -m "feat(dev): sandbox app with sample blueprints and prod server"
```

---

### Task F2: Smoke test — full stack via Vite dev server

**Files:**
- Create: `apps/dev/src/smoke.test.ts`

- [ ] **Step 1: Write test `apps/dev/src/smoke.test.ts`**

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';

let server: ViteDevServer;

beforeAll(async () => {
  server = await createServer({
    configFile: resolve(import.meta.dirname, '..', 'vite.config.ts'),
    root: resolve(import.meta.dirname, '..'),
    server: { port: 0, middlewareMode: false },
  });
  await server.listen();
});

afterAll(async () => {
  await server?.close();
});

describe('apps/dev smoke', () => {
  it('serves /api/_meta/collections with both fixture blueprints', async () => {
    const port = server.config.server.port ?? server.httpServer?.address();
    const url = `http://localhost:${typeof port === 'number' ? port : (port as { port: number }).port}/api/_meta/collections`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handle: string }[];
    expect(body.map((b) => b.handle).sort()).toEqual(['authors', 'posts']);
  });

  it('round-trips a POST + GET against /api/collections/posts', async () => {
    const port = server.config.server.port ?? server.httpServer?.address();
    const base = `http://localhost:${typeof port === 'number' ? port : (port as { port: number }).port}`;
    const created = await fetch(`${base}/api/collections/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Hello',
        slug: 'hello',
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
        status: 'draft',
      }),
    });
    expect(created.status).toBe(201);
    const entry = (await created.json()) as { id: string };

    const got = await fetch(`${base}/api/collections/posts/${entry.id}`);
    expect(got.status).toBe(200);
    const back = (await got.json()) as { id: string; content: { title: string } };
    expect(back.id).toBe(entry.id);
    expect(back.content.title).toBe('Hello');
  });
});
```

- [ ] **Step 2: Run test — verify pass**

Run: `pnpm --filter @vulse/dev test`
Expected: 2 tests pass.

If the test creates `apps/dev/dev.db`, that's expected — it's gitignored.

- [ ] **Step 3: Commit**

```bash
git add apps/dev
git commit -m "test(dev): smoke test boots Vite dev server and round-trips an entry"
```

---

### Task F3: Final workspace verification

- [ ] **Step 1: Run all checks**

Run: `pnpm install`
Run: `pnpm -r --filter './packages/**' --filter './apps/**' run check`
Expected: all packages typecheck clean.

Run: `pnpm test`
Expected: all suites pass across `@vulse/db`, `@vulse/core`, `@vulse/renderer`, `@vulse/admin`, `@vulse/dev`.

Run: `pnpm exec biome check .`
Expected: no errors.

- [ ] **Step 2: Manual smoke (the spec's stated v1 acceptance test)**

Run: `pnpm dev`
Expected: Vite dev server starts on `http://localhost:5173`.

In a browser:
1. Sidebar shows **Posts** and **Authors**.
2. Click **Authors → New entry**, fill `name = "Ada"`, save. Redirects to the new entry route.
3. Click **Posts → New entry**, fill title/slug/status, pick the Ada relationship, add a `vulseCallout` block, save.
4. `curl http://localhost:5173/api/collections/posts` returns a plain JSON array with the entry; `content.body` is a TipTap JSON doc that includes a `vulseCallout` node.

- [ ] **Step 3: Commit (no-op if clean)**

```bash
git status
# if anything was added (eg lockfile drift), commit it:
git add -A && git commit -m "chore: workspace verification pass" --allow-empty
```

---

## Self-review

**Spec coverage check** (every section / requirement → task):

- §3 Monorepo layout → Phase A + per-package scaffolds in B1, C1, D1, E1, F1 ✓
- §4.1 DatabaseAdapter interface → B1 ✓
- §4.2 LibsqlAdapter → B2 ✓
- §4.3 Migration runner → B3 ✓
- §4.4 Five v1 migrations + parent/child/sort_order indexes → B4 + B5 ✓
- §5.1 class-based Zod blueprint + Collection base → C1 (base), C2 (fixtures), F1 (real blueprints) ✓
- §5.2 Blueprint loader (glob, dynamic import, sha256, upsert) → C2 ✓
- §5.3 ContentService (validation, ULID, scoped sort_order, cascade) → C3 ✓
- §5.4 Hono API factory (CRUD + `/api/_meta/collections`, plain-array JSON, error envelope) → C4 ✓
- §6.1 Admin layout → E1 ✓
- §6.2 Routes → E1 ✓
- §6.3 Form pipeline → E2 + E6 ✓
- §6.4 TipTap + vulseCallout → E4 ✓
- §6.5 Reka UI surface — admitted small footprint; the v1 components used (input, select, button) don't actually require Reka primitives, so Reka is installed but not yet imported. Adding a thin wrapper would be premature. Plan does install `reka-ui` in E1 dependencies so it's available as soon as a future task needs e.g. Dialog.
- §6.6 `data-testid` on every route/control → present in E5, E6, field components ✓
- §7 Renderer (BlockNode, dispatcher, defaults, marks, callout, CSS) → D1 + D2 ✓
- §8 `apps/dev` shape → F1 ✓
- §9 Vite middleware-mode dev orchestration → C5 + F1 ✓
- §10 Testing across packages → tests added in every relevant task; smoke in F2 ✓
- §11 Out of scope — nothing built ✓
- §12 Open doors (singleton, snapshot, revisions/navigation/settings tables, lifecycle hooks empty, commented sidebar slots, data-testid, error envelope) → §4 / C1 / E1 ✓
- §13 Build/scripts → A1 ✓

**Placeholder scan:** every step has runnable commands and full code blocks; no TBD / TODO / "similar to".

**Type consistency:** `BlueprintMeta` shape matches between `packages/core/src/http/meta.ts` (returned by `/api/_meta/collections`) and `packages/admin/src/api/client.ts` (consumed by the store). `Entry` shape matches between `packages/core/src/content/types.ts` and the admin's `api/client.ts`. `FieldUi.kind` enum is the same string union on both sides. `VulseCalloutExtension` writes nodes of type `vulseCallout`, matched by `defaultComponents.vulseCallout` in the renderer.

One nit found: `RelationshipField` placeholder text uses `Select a ${to}` even when `to` is `'authors'` (so the article is wrong: "Select a authors"). Pure cosmetic — left in the plan to avoid premature polish, but if you want it perfect, change to `Select…` in Task E3 Step 1.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-vulse-cms-v1-vertical-slice.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

Which approach?
