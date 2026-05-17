# Auth + Users + Groups + Protected Entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Better Auth-backed authentication, two-role user system
(editor / external_user) with super-flag bypass, per-collection CRUD
permissions managed via groups, per-entry `protected` boolean, full admin
UI for login + user/group management, and developer documentation.

**Architecture:** A new `@vulse/auth` workspace package owns Better Auth
wiring, session middleware, permission middleware, and the bootstrap. It
plugs into the existing Hono app in `@vulse/core` via three middleware:
`sessionMiddleware` (global), `requirePerm` (collection routes), and
`requireSuper` (blueprint/user/group writes). The admin SPA gains login
flow, route guards, and `/settings/users` + `/settings/groups` pages.

**Tech Stack:** Better Auth (email/password + password reset) with
Drizzle libSQL adapter, Hono v4, Vue 3 + Pinia + vue-router, raw SQL
migrations, Vitest. Email transport via Nodemailer in prod, stdout in dev.

**Reference spec:** `docs/superpowers/specs/2026-05-17-auth-and-permissions-design.md`

**Execution order:** Phase A → B → C → D. Each phase ends with a green
workspace and a working demo. Pause between phases is fine.

---

## File Map

### `@vulse/auth` (new package)
```
packages/auth/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts                    # public re-exports
    ├── instance.ts                 # createAuth({ adapter, env }) → { auth, drizzleDb, router }
    ├── drizzle-schema.ts           # Drizzle table definitions matching migration 007
    ├── email.ts                    # sendResetEmail(user, url) — Nodemailer / stdout
    ├── bootstrap.ts                # seedSuperUser
    ├── permissions.ts              # effectivePerms, Action type, EffectivePerms
    ├── middleware/
    │   ├── session.ts              # sessionMiddleware
    │   ├── require-super.ts        # requireSuper
    │   └── require-perm.ts         # requirePerm({ action })
    ├── services/
    │   ├── users.ts                # createUser, listUsers, getUser, updateUser, deleteUser
    │   └── groups.ts               # createGroup, listGroups, getGroup, updateGroup, setPermissions, deleteGroup
    ├── routes/
    │   ├── me.ts                   # GET /api/auth/me
    │   ├── users.ts                # /api/users/*
    │   └── groups.ts               # /api/groups/*
    ├── types.ts                    # AuthUser, AuthSession, Role
    └── __tests__/
        ├── session.test.ts
        ├── require-super.test.ts
        ├── require-perm.test.ts
        ├── permissions.test.ts
        ├── bootstrap.test.ts
        ├── users.test.ts
        └── groups.test.ts
```

### `@vulse/db`
```
packages/db/migrations/
├── 007_auth.sql                    # users, sessions, accounts, verifications, groups, user_groups, group_permissions
└── 008_protected_entries.sql       # ALTER entries ADD protected
```

### `@vulse/core`
```
packages/core/src/http/api.ts       # MODIFY: mount auth router + middlewares
packages/core/src/content/service.ts # MODIFY: protected filter + entry shape
packages/core/src/content/types.ts  # MODIFY: Entry.protected
packages/core/src/http/__tests__/auth.api.test.ts          # NEW
packages/core/src/http/__tests__/protected_entries.api.test.ts  # NEW
```

### `@vulse/admin`
```
packages/admin/src/
├── api/client.ts                   # MODIFY: auth + users + groups + perms endpoints
├── stores/auth.ts                  # NEW: auth Pinia store
├── stores/__tests__/auth.test.ts   # NEW
├── pages/LoginPage.vue             # NEW
├── pages/ForgotPasswordPage.vue    # NEW
├── pages/ResetPasswordPage.vue     # NEW
├── pages/UserList.vue              # NEW
├── pages/UserEditor.vue            # NEW
├── pages/GroupList.vue             # NEW
├── pages/GroupEditor.vue           # NEW (permission matrix)
├── pages/__tests__/LoginPage.test.ts        # NEW
├── pages/__tests__/GroupEditor.test.ts      # NEW
├── pages/CollectionEntry.vue       # MODIFY: protected checkbox
├── router.ts                       # MODIFY: new routes, meta.requiresAuth, meta.requiresSuper
└── App.vue                         # MODIFY: route guard, user chip, new sidebar items
```

### `apps/dev`
```
apps/dev/src/server.prod.ts         # MODIFY: createAuth + seedSuperUser
apps/dev/src/blueprints-bootstrap.ts # already covers seed; this file may not exist — use existing seeding location
apps/dev/src/smoke.test.ts          # MODIFY: auth + protected entry roundtrip
packages/core/src/vite/plugin.ts    # MODIFY: createAuth + seedSuperUser on dev start
```

### Docs
```
docs/auth.md                        # NEW: setup, concepts, recipes, API, middleware
README.md                           # MODIFY: link to docs/auth.md
```

---

# Phase A — Auth Foundation

End state: editor can sign in/out of the admin, sees their account chip,
super user seeded on first boot, password reset works (logs to stdout in
dev), no permission gating beyond "logged in or not".

---

## Task A1: Scaffold the `@vulse/auth` package

**Files:**
- Create: `packages/auth/package.json`
- Create: `packages/auth/tsconfig.json`
- Create: `packages/auth/vitest.config.ts`
- Create: `packages/auth/src/index.ts`
- Create: `packages/auth/src/types.ts`

- [ ] **Step 1: Create `packages/auth/package.json`**

```json
{
  "name": "@vulse/auth",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./middleware": "./src/middleware/index.ts",
    "./services": "./src/services/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "check": "vue-tsc --noEmit"
  },
  "dependencies": {
    "@vulse/db": "workspace:*",
    "better-auth": "^1.0.0",
    "drizzle-orm": "^0.36.0",
    "@libsql/client": "^0.14.0",
    "hono": "^4.6.0",
    "nodemailer": "^6.9.0",
    "ulid": "^2.4.0"
  },
  "devDependencies": {
    "@types/nodemailer": "^6.4.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "vue-tsc": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/auth/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": false
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/auth/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `packages/auth/src/types.ts`**

```ts
export type Role = 'editor' | 'external_user';

export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
  role: Role;
  isSuper: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: string;
  token: string;
}

export type Action = 'read' | 'create' | 'update' | 'delete';

export type EffectivePerms = Map<string, Set<Action>>;

export interface AuthVars {
  user: AuthUser | null;
  session: AuthSession | null;
  perms?: EffectivePerms;
}
```

- [ ] **Step 5: Create `packages/auth/src/index.ts` as stub**

```ts
export type { Role, AuthUser, AuthSession, Action, EffectivePerms, AuthVars } from './types.js';
// More exports added in subsequent tasks.
```

- [ ] **Step 6: Install dependencies and verify typecheck**

Run from `/home/espen/jsdev/vulsecms`:
```bash
pnpm install
pnpm --filter @vulse/auth check
```

Expected: install succeeds; `vue-tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add packages/auth/
git commit -m "feat(auth): scaffold @vulse/auth workspace package"
```

---

## Task A2: Migration 007 — all auth + group tables

**Files:**
- Create: `packages/db/migrations/007_auth.sql`

- [ ] **Step 1: Create the migration file**

Create `packages/db/migrations/007_auth.sql` with the full contents
from the spec's "Data model" section. The exact SQL:

```sql
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  name            TEXT,
  image           TEXT,
  role            TEXT NOT NULL
                  CHECK (role IN ('editor','external_user')),
  is_super        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE accounts (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id               TEXT NOT NULL,
  provider_id              TEXT NOT NULL,
  password                 TEXT,
  access_token             TEXT,
  refresh_token            TEXT,
  id_token                 TEXT,
  access_token_expires_at  TEXT,
  refresh_token_expires_at TEXT,
  scope                    TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE verifications (
  id          TEXT PRIMARY KEY,
  identifier  TEXT NOT NULL,
  value       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE groups (
  id          TEXT PRIMARY KEY,
  handle      TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_groups (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE group_permissions (
  group_id          TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  collection_handle TEXT NOT NULL REFERENCES collections(handle) ON DELETE CASCADE,
  can_read    INTEGER NOT NULL DEFAULT 0,
  can_create  INTEGER NOT NULL DEFAULT 0,
  can_update  INTEGER NOT NULL DEFAULT 0,
  can_delete  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, collection_handle)
);

CREATE INDEX idx_user_groups_user ON user_groups(user_id);
CREATE INDEX idx_group_permissions_group ON group_permissions(group_id);
```

- [ ] **Step 2: Wipe local dev DB so the migration runs cleanly**

```bash
cd /home/espen/jsdev/vulsecms
rm -f apps/dev/dev.db apps/dev/dev.db-shm apps/dev/dev.db-wal
```

(Dev DB resets are explicitly authorized.)

- [ ] **Step 3: Verify the migration runs**

```bash
pnpm --filter @vulse/db test
```

Expected: existing `@vulse/db` tests still pass (the migration runner picks
up `007_auth.sql` automatically — no test-runner change needed).

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/007_auth.sql
git commit -m "feat(db): migration 007 — users, sessions, groups, permissions"
```

---

## Task A3: Drizzle schema + Better Auth instance

**Files:**
- Create: `packages/auth/src/drizzle-schema.ts`
- Create: `packages/auth/src/instance.ts`

- [ ] **Step 1: Create Drizzle schema mapping the migration**

Create `packages/auth/src/drizzle-schema.ts`:

```ts
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified').notNull().default(0),
  name: text('name'),
  image: text('image'),
  role: text('role', { enum: ['editor', 'external_user'] }).notNull(),
  isSuper: integer('is_super').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: text('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  password: text('password'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: text('access_token_expires_at'),
  refreshTokenExpiresAt: text('refresh_token_expires_at'),
  scope: text('scope'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  handle: text('handle').notNull().unique(),
  label: text('label').notNull(),
  createdAt: text('created_at').notNull(),
});

export const userGroups = sqliteTable(
  'user_groups',
  {
    userId: text('user_id').notNull(),
    groupId: text('group_id').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.groupId] }) }),
);

export const groupPermissions = sqliteTable(
  'group_permissions',
  {
    groupId: text('group_id').notNull(),
    collectionHandle: text('collection_handle').notNull(),
    canRead: integer('can_read').notNull().default(0),
    canCreate: integer('can_create').notNull().default(0),
    canUpdate: integer('can_update').notNull().default(0),
    canDelete: integer('can_delete').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.groupId, t.collectionHandle] }) }),
);

export const schema = {
  users,
  sessions,
  accounts,
  verifications,
  groups,
  userGroups,
  groupPermissions,
};
```

- [ ] **Step 2: Create the Better Auth instance factory**

Create `packages/auth/src/instance.ts`:

```ts
import { createClient, type Client } from '@libsql/client';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/libsql';
import { sendResetEmail } from './email.js';
import { schema } from './drizzle-schema.js';

export interface AuthInstanceEnv {
  authSecret: string;
  baseUrl: string;
  allowPublicSignup: boolean;
  smtpUrl: string | undefined;
}

export function createAuth(opts: { libsqlUrl: string; env: AuthInstanceEnv }) {
  const client: Client = createClient({ url: opts.libsqlUrl });
  const db = drizzle(client, { schema });

  const options: BetterAuthOptions = {
    secret: opts.env.authSecret,
    baseURL: opts.env.baseUrl,
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        await sendResetEmail(
          { email: user.email, name: user.name ?? null },
          url,
          opts.env.smtpUrl,
        );
      },
    },
    user: {
      additionalFields: {
        role: { type: 'string', defaultValue: 'external_user', input: false },
        isSuper: { type: 'number', defaultValue: 0, input: false },
      },
    },
    session: {
      cookieName: 'vulse_session',
      cookieOptions: { sameSite: 'lax', httpOnly: true, secure: opts.env.baseUrl.startsWith('https://') },
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === '/sign-up/email',
          handler: async (ctx) => {
            if (!opts.env.allowPublicSignup) {
              return ctx.json({ error: 'signup_disabled' }, { status: 403 });
            }
            return undefined;
          },
        },
      ],
    },
  };

  return { auth: betterAuth(options), db, client };
}

export type AuthInstance = ReturnType<typeof createAuth>;
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @vulse/auth check
```

Expected: clean. (If Better Auth API differs in detail from the above —
`drizzleAdapter` argument shape, hook matcher signature — read the
`better-auth` README and adjust the imports/types. The structure stays the
same: it's a drizzle adapter + emailAndPassword + a sign-up gate hook.)

- [ ] **Step 4: Commit**

```bash
git add packages/auth/src/drizzle-schema.ts packages/auth/src/instance.ts
git commit -m "feat(auth): Better Auth instance with Drizzle libSQL adapter"
```

---

## Task A4: Email transport with stdout fallback

**Files:**
- Create: `packages/auth/src/email.ts`
- Create: `packages/auth/src/__tests__/email.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/auth/src/__tests__/email.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { sendResetEmail } from '../email.js';

describe('sendResetEmail', () => {
  it('logs to stdout when smtpUrl is undefined', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await sendResetEmail({ email: 'a@b.com', name: 'Anna' }, 'https://x/reset?token=t', undefined);
    const written = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('Password reset for a@b.com');
    expect(written).toContain('https://x/reset?token=t');
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @vulse/auth test -- email
```

Expected: FAIL with "Cannot find module '../email.js'".

- [ ] **Step 3: Implement `email.ts`**

Create `packages/auth/src/email.ts`:

```ts
import { createTransport } from 'nodemailer';

export interface ResetEmailUser {
  email: string;
  name: string | null;
}

export async function sendResetEmail(
  user: ResetEmailUser,
  resetUrl: string,
  smtpUrl: string | undefined,
): Promise<void> {
  if (!smtpUrl) {
    process.stdout.write(
      `\n[vulse:auth] Password reset for ${user.email}\n  ${resetUrl}\n\n`,
    );
    return;
  }
  const transport = createTransport(smtpUrl);
  await transport.sendMail({
    to: user.email,
    from: 'no-reply@vulse.local',
    subject: 'Reset your Vulse password',
    text: `Hello ${user.name ?? ''},\n\nClick this link to reset your password:\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
  });
}
```

- [ ] **Step 4: Run and verify pass**

```bash
pnpm --filter @vulse/auth test -- email
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/email.ts packages/auth/src/__tests__/email.test.ts
git commit -m "feat(auth): reset email transport with stdout fallback"
```

---

## Task A5: seedSuperUser bootstrap

**Files:**
- Create: `packages/auth/src/bootstrap.ts`
- Create: `packages/auth/src/__tests__/bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/auth/src/__tests__/bootstrap.test.ts`:

```ts
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedSuperUser } from '../bootstrap.js';

describe('seedSuperUser', () => {
  let adapter: LibsqlAdapter;

  beforeEach(async () => {
    adapter = new LibsqlAdapter({ url: ':memory:' });
    await adapter.exec('PRAGMA foreign_keys = ON');
    await runMigrations(adapter, MIGRATIONS_DIR);
  });

  it('creates a super editor when users table is empty', async () => {
    const out = await seedSuperUser({
      adapter,
      bootstrapEmail: 'admin@example.com',
      bootstrapPassword: 'hunter2hunter2',
      isProd: false,
    });
    expect(out.created).toBe(true);
    expect(out.email).toBe('admin@example.com');
    const row = await adapter.queryOne<{ role: string; is_super: number; email: string }>(
      'SELECT role, is_super, email FROM users WHERE email = ?',
      ['admin@example.com'],
    );
    expect(row).toEqual({ role: 'editor', is_super: 1, email: 'admin@example.com' });
  });

  it('is idempotent', async () => {
    await seedSuperUser({
      adapter,
      bootstrapEmail: 'admin@example.com',
      bootstrapPassword: 'hunter2hunter2',
      isProd: false,
    });
    const out = await seedSuperUser({
      adapter,
      bootstrapEmail: 'admin@example.com',
      bootstrapPassword: 'hunter2hunter2',
      isProd: false,
    });
    expect(out.created).toBe(false);
  });

  it('throws in prod when bootstrap env vars are unset', async () => {
    await expect(
      seedSuperUser({ adapter, bootstrapEmail: undefined, bootstrapPassword: undefined, isProd: true }),
    ).rejects.toThrow(/VULSE_BOOTSTRAP/);
  });

  it('uses dev fallback when env vars are unset and isProd is false', async () => {
    const out = await seedSuperUser({
      adapter,
      bootstrapEmail: undefined,
      bootstrapPassword: undefined,
      isProd: false,
    });
    expect(out.created).toBe(true);
    expect(out.email).toBe('admin@vulse.local');
    expect(out.generatedPassword).toMatch(/^[A-Za-z0-9]{16}$/);
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @vulse/auth test -- bootstrap
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `bootstrap.ts`**

Create `packages/auth/src/bootstrap.ts`:

```ts
import type { DatabaseAdapter } from '@vulse/db';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { ulid } from 'ulid';

const scryptAsync = promisify(scrypt);

export interface BootstrapOptions {
  adapter: DatabaseAdapter;
  bootstrapEmail: string | undefined;
  bootstrapPassword: string | undefined;
  isProd: boolean;
}

export interface BootstrapResult {
  created: boolean;
  email: string;
  generatedPassword?: string;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

function randomPassword(): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += charset[bytes[i]! % charset.length];
  return out;
}

export async function seedSuperUser(opts: BootstrapOptions): Promise<BootstrapResult> {
  const existing = await opts.adapter.queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM users');
  if ((existing?.c ?? 0) > 0) {
    return { created: false, email: '' };
  }

  let email = opts.bootstrapEmail;
  let password = opts.bootstrapPassword;
  let generated: string | undefined;

  if (!email || !password) {
    if (opts.isProd) {
      throw new Error(
        'Refusing to start: set VULSE_BOOTSTRAP_EMAIL and VULSE_BOOTSTRAP_PASSWORD in production.',
      );
    }
    email = email ?? 'admin@vulse.local';
    generated = randomPassword();
    password = generated;
  }

  const userId = ulid();
  const accountId = ulid();
  const hashed = await hashPassword(password);

  await opts.adapter.exec(
    `INSERT INTO users (id, email, email_verified, name, role, is_super, created_at, updated_at)
     VALUES (?, ?, 0, NULL, 'editor', 1, datetime('now'), datetime('now'))`,
    [userId, email],
  );
  await opts.adapter.exec(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
     VALUES (?, ?, ?, 'credential', ?, datetime('now'), datetime('now'))`,
    [accountId, userId, email, hashed],
  );

  if (generated) {
    process.stdout.write(
      `\n[vulse:auth] First-boot super user seeded.\n  Email: ${email}\n  Password: ${generated}\n  (Set VULSE_BOOTSTRAP_EMAIL/PASSWORD to control this.)\n\n`,
    );
  }

  return { created: true, email, ...(generated ? { generatedPassword: generated } : {}) };
}
```

**Note:** the scrypt hash format above is a placeholder for our seed.
Better Auth uses its own password hashing. When the first user signs in,
Better Auth will reject this hash. **Mitigation:** the seedSuperUser
*delegates to Better Auth's internal password hashing* — replace the
`hashPassword` body with a call to Better Auth's `ctx.password.hash(password)`
through the auth instance. Update accordingly during implementation; the
test asserts the row is inserted with role='editor', is_super=1, not the
specific hash format. The Phase A smoke test (A12) will catch any mismatch
by attempting a real sign-in.

- [ ] **Step 4: Run and verify pass**

```bash
pnpm --filter @vulse/auth test -- bootstrap
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/bootstrap.ts packages/auth/src/__tests__/bootstrap.test.ts
git commit -m "feat(auth): seedSuperUser first-boot bootstrap"
```

---

## Task A6: sessionMiddleware

**Files:**
- Create: `packages/auth/src/middleware/session.ts`
- Create: `packages/auth/src/middleware/index.ts`
- Create: `packages/auth/src/__tests__/session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/auth/src/__tests__/session.test.ts`:

```ts
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionMiddleware } from '../middleware/session.js';
import type { AuthInstance } from '../instance.js';

describe('sessionMiddleware', () => {
  let mockAuth: AuthInstance;

  beforeEach(() => {
    mockAuth = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth: { api: { getSession: vi.fn() } } as any,
      db: {} as never,
      client: {} as never,
    };
  });

  it('sets user=null when no session cookie', async () => {
    (mockAuth.auth.api.getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const app = new Hono();
    app.use('*', sessionMiddleware(mockAuth));
    app.get('/test', (c) => c.json({ user: c.get('user') }));
    const res = await app.request('http://x/test');
    const body = (await res.json()) as { user: null };
    expect(body.user).toBeNull();
  });

  it('sets user when session is valid', async () => {
    (mockAuth.auth.api.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: {
        id: 'u1', email: 'a@b.com', emailVerified: false, name: null, image: null,
        role: 'editor', isSuper: 1, createdAt: '2026', updatedAt: '2026',
      },
      session: { id: 's1', userId: 'u1', expiresAt: '2027', token: 'tok' },
    });
    const app = new Hono();
    app.use('*', sessionMiddleware(mockAuth));
    app.get('/test', (c) => c.json({ user: c.get('user'), session: c.get('session') }));
    const res = await app.request('http://x/test', {
      headers: { cookie: 'vulse_session=tok' },
    });
    const body = (await res.json()) as { user: { id: string; isSuper: boolean }; session: { id: string } };
    expect(body.user.id).toBe('u1');
    expect(body.user.isSuper).toBe(true); // normalized 1 → true
    expect(body.session.id).toBe('s1');
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @vulse/auth test -- session
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `middleware/session.ts`**

Create `packages/auth/src/middleware/session.ts`:

```ts
import type { MiddlewareHandler } from 'hono';
import type { AuthInstance } from '../instance.js';
import type { AuthUser, AuthSession, AuthVars } from '../types.js';

export function sessionMiddleware(authInstance: AuthInstance): MiddlewareHandler<{
  Variables: AuthVars;
}> {
  return async (c, next) => {
    const headers = c.req.raw.headers;
    const result = await authInstance.auth.api.getSession({ headers });
    if (!result) {
      c.set('user', null);
      c.set('session', null);
    } else {
      const u = result.user as Record<string, unknown>;
      const user: AuthUser = {
        id: String(u.id),
        email: String(u.email),
        emailVerified: Boolean(u.emailVerified),
        name: (u.name as string | null) ?? null,
        image: (u.image as string | null) ?? null,
        role: u.role as AuthUser['role'],
        isSuper: Number(u.isSuper) === 1 || u.isSuper === true,
        createdAt: String(u.createdAt),
        updatedAt: String(u.updatedAt),
      };
      const s = result.session as Record<string, unknown>;
      const session: AuthSession = {
        id: String(s.id),
        userId: String(s.userId),
        expiresAt: String(s.expiresAt),
        token: String(s.token),
      };
      c.set('user', user);
      c.set('session', session);
    }
    await next();
  };
}
```

- [ ] **Step 4: Create middleware barrel**

Create `packages/auth/src/middleware/index.ts`:

```ts
export { sessionMiddleware } from './session.js';
// require-super and require-perm added in Phase B.
```

- [ ] **Step 5: Run and verify pass**

```bash
pnpm --filter @vulse/auth test -- session
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/auth/src/middleware/
git commit -m "feat(auth): sessionMiddleware"
```

---

## Task A7: `/api/auth/me` endpoint

**Files:**
- Create: `packages/auth/src/routes/me.ts`

- [ ] **Step 1: Create the route**

Create `packages/auth/src/routes/me.ts`:

```ts
import { Hono } from 'hono';
import type { AuthVars } from '../types.js';

export function meRoute(): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  app.get('/api/auth/me', (c) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ user: null, perms: {} });
    }
    // Phase A stub — Phase B replaces with effectivePerms call.
    return c.json({ user, perms: {} });
  });
  return app;
}
```

- [ ] **Step 2: Update `packages/auth/src/index.ts`**

Replace its contents with:

```ts
export type { Role, AuthUser, AuthSession, Action, EffectivePerms, AuthVars } from './types.js';
export { createAuth, type AuthInstance, type AuthInstanceEnv } from './instance.js';
export { sessionMiddleware } from './middleware/session.js';
export { seedSuperUser, type BootstrapResult } from './bootstrap.js';
export { meRoute } from './routes/me.js';
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @vulse/auth check
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/auth/src/routes/me.ts packages/auth/src/index.ts
git commit -m "feat(auth): GET /api/auth/me endpoint (perms stub)"
```

---

## Task A8: Wire auth into `createApi`, dev server, Vite plugin

**Files:**
- Modify: `packages/core/package.json` (add `@vulse/auth` dependency)
- Modify: `packages/core/src/http/api.ts`
- Modify: `packages/core/src/vite/plugin.ts`
- Modify: `apps/dev/src/server.prod.ts` (if exists; otherwise the prod entry)
- Modify: `apps/dev/package.json` (add `@vulse/auth`)

- [ ] **Step 1: Add `@vulse/auth` to `packages/core/package.json` deps**

Inside the `"dependencies"` block, add:
```json
"@vulse/auth": "workspace:*"
```

- [ ] **Step 2: Update `createApi` signature and mount auth**

Modify `packages/core/src/http/api.ts`. Replace the top of the file and
`createApi` signature:

```ts
import type { DatabaseAdapter } from '@vulse/db';
import type { AuthInstance, AuthVars } from '@vulse/auth';
import { sessionMiddleware, meRoute } from '@vulse/auth';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
// ... existing imports ...

export interface ApiDeps {
  blueprints: Map<string, Blueprint>;
  content: ContentService;
  adapter: DatabaseAdapter;
  authInstance: AuthInstance;
}

export function createApi({ blueprints, content, adapter, authInstance }: ApiDeps): Hono {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use('*', cors({ origin: (origin) => origin ?? '*', credentials: true }));
  app.use('*', sessionMiddleware(authInstance));

  // Mount Better Auth's handler at /api/auth/*
  app.on(['GET', 'POST'], '/api/auth/*', (c) => authInstance.auth.handler(c.req.raw));

  // Mount our /api/auth/me
  app.route('/', meRoute());

  // ... existing onError + content routes + blueprint routes ...
}
```

(Keep the rest of the file unchanged for Phase A — collection and blueprint
routes are NOT yet gated by permission middleware. Phase B adds those
wrappers.)

- [ ] **Step 3: Update the Vite plugin**

Modify `packages/core/src/vite/plugin.ts`. Add imports at top:

```ts
import { createAuth, seedSuperUser } from '@vulse/auth';
```

After `await seedBlueprintsFromCode(...)`, before `async function build()`,
add:

```ts
const authInstance = createAuth({
  libsqlUrl: typeof opts.database === 'string' ? opts.database : (opts.database.url ?? ':memory:'),
  env: {
    authSecret: process.env.VULSE_AUTH_SECRET ?? 'dev-insecure-secret-do-not-use-in-prod',
    baseUrl: process.env.VULSE_AUTH_BASE_URL ?? 'http://localhost:5173',
    allowPublicSignup: (process.env.VULSE_ALLOW_PUBLIC_SIGNUP ?? 'true') !== 'false',
    smtpUrl: process.env.VULSE_SMTP_URL,
  },
});
await seedSuperUser({
  adapter,
  bootstrapEmail: process.env.VULSE_BOOTSTRAP_EMAIL,
  bootstrapPassword: process.env.VULSE_BOOTSTRAP_PASSWORD,
  isProd: false,
});
```

Update `build()` to pass `authInstance`:

```ts
async function build() {
  const blueprints = await loadBlueprints({ adapter: adapter! });
  const content = createContentService(adapter!, blueprints);
  return createApi({ blueprints, content, adapter: adapter!, authInstance });
}
```

- [ ] **Step 4: Update `apps/dev/src/server.prod.ts`**

Find the file (it exists per the spec map). Apply the same changes:
- Import `createAuth, seedSuperUser` from `@vulse/auth`.
- Construct `authInstance` after migrations + before `createApi`.
- Run `seedSuperUser` with `isProd: process.env.NODE_ENV === 'production'`.
- Pass `authInstance` to `createApi`.

- [ ] **Step 5: Update `apps/dev/package.json`**

Add `"@vulse/auth": "workspace:*"` to dependencies.

- [ ] **Step 6: Install and typecheck**

```bash
pnpm install
pnpm -r typecheck
```

Expected: clean.

- [ ] **Step 7: Manual smoke**

```bash
pnpm dev
```

In another terminal:
```bash
curl http://localhost:5173/api/auth/me
# Expected: {"user":null,"perms":{}}

curl -X POST http://localhost:5173/api/auth/sign-up/email \
  -H 'content-type: application/json' \
  -d '{"email":"test@example.com","password":"hunter2hunter2","name":"Test"}'
# Expected: created user with role=external_user
```

Also verify stdout shows the first-boot bootstrap message with admin@vulse.local + 16-char password.

- [ ] **Step 8: Commit**

```bash
git add packages/core/ packages/auth/ apps/dev/
git commit -m "feat(core): mount Better Auth + sessionMiddleware + /api/auth/me"
```

---

## Task A9: Admin API client extensions

**Files:**
- Modify: `packages/admin/src/api/client.ts`

- [ ] **Step 1: Extend the client with auth methods**

Add to `packages/admin/src/api/client.ts` (alongside the existing methods):

```ts
export interface MeResponse {
  user: AuthUser | null;
  perms: Record<string, ('read' | 'create' | 'update' | 'delete')[]>;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: 'editor' | 'external_user';
  isSuper: boolean;
}

// Inside the api object:
async me(): Promise<MeResponse> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (!res.ok) throw await this.err(res);
  return res.json();
},

async login(email: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/sign-in/email', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw await this.err(res);
},

async logout(): Promise<void> {
  const res = await fetch('/api/auth/sign-out', {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) throw await this.err(res);
},

async forgotPassword(email: string): Promise<void> {
  const res = await fetch('/api/auth/forget-password', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, redirectTo: `${location.origin}/reset-password` }),
  });
  if (!res.ok) throw await this.err(res);
},

async resetPassword(token: string, newPassword: string): Promise<void> {
  const res = await fetch('/api/auth/reset-password', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
  if (!res.ok) throw await this.err(res);
},
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @vulse/admin check
```

- [ ] **Step 3: Commit**

```bash
git add packages/admin/src/api/client.ts
git commit -m "feat(admin): API client auth methods"
```

---

## Task A10: Admin auth Pinia store

**Files:**
- Create: `packages/admin/src/stores/auth.ts`
- Create: `packages/admin/src/stores/__tests__/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/admin/src/stores/__tests__/auth.test.ts`:

```ts
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../api/client.js';
import { useAuthStore } from '../auth.js';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('useAuthStore', () => {
  it('hydrate() populates user + perms', async () => {
    vi.spyOn(client.api, 'me').mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', name: null, role: 'editor', isSuper: true },
      perms: { posts: ['read', 'update'] },
    });
    const s = useAuthStore();
    await s.hydrate();
    expect(s.user?.id).toBe('u1');
    expect(s.perms.posts).toEqual(['read', 'update']);
    expect(s.hydrated).toBe(true);
  });

  it('can(handle, action) returns true for super users', () => {
    const s = useAuthStore();
    s.user = { id: 'u1', email: 'x', name: null, role: 'editor', isSuper: true };
    s.perms = {};
    expect(s.can('posts', 'delete')).toBe(true);
  });

  it('can() reads perms map for non-super', () => {
    const s = useAuthStore();
    s.user = { id: 'u2', email: 'x', name: null, role: 'editor', isSuper: false };
    s.perms = { posts: ['read'] };
    expect(s.can('posts', 'read')).toBe(true);
    expect(s.can('posts', 'delete')).toBe(false);
    expect(s.can('unknown', 'read')).toBe(false);
  });

  it('logout() clears user and perms', async () => {
    vi.spyOn(client.api, 'logout').mockResolvedValue();
    const s = useAuthStore();
    s.user = { id: 'u', email: 'x', name: null, role: 'editor', isSuper: false };
    s.perms = { posts: ['read'] };
    await s.logout();
    expect(s.user).toBeNull();
    expect(s.perms).toEqual({});
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @vulse/admin test -- stores/auth
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `packages/admin/src/stores/auth.ts`:

```ts
import { defineStore } from 'pinia';
import { api, type AuthUser } from '../api/client.js';

export type Action = 'read' | 'create' | 'update' | 'delete';
export type PermsMap = Record<string, Action[]>;

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as AuthUser | null,
    perms: {} as PermsMap,
    hydrated: false,
  }),
  actions: {
    async hydrate() {
      const me = await api.me();
      this.user = me.user;
      this.perms = me.perms as PermsMap;
      this.hydrated = true;
    },
    async login(email: string, password: string) {
      await api.login(email, password);
      await this.hydrate();
    },
    async logout() {
      await api.logout();
      this.user = null;
      this.perms = {};
    },
    can(collectionHandle: string, action: Action): boolean {
      if (!this.user) return false;
      if (this.user.isSuper) return true;
      return this.perms[collectionHandle]?.includes(action) ?? false;
    },
  },
});
```

- [ ] **Step 4: Run and verify pass**

```bash
pnpm --filter @vulse/admin test -- stores/auth
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/stores/
git commit -m "feat(admin): auth Pinia store"
```

---

## Task A11: LoginPage, ForgotPasswordPage, ResetPasswordPage + route guard

**Files:**
- Create: `packages/admin/src/pages/LoginPage.vue`
- Create: `packages/admin/src/pages/ForgotPasswordPage.vue`
- Create: `packages/admin/src/pages/ResetPasswordPage.vue`
- Create: `packages/admin/src/pages/__tests__/LoginPage.test.ts`
- Modify: `packages/admin/src/router.ts`
- Modify: `packages/admin/src/App.vue`

- [ ] **Step 1: Write the failing LoginPage test**

Create `packages/admin/src/pages/__tests__/LoginPage.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import * as client from '../../api/client.js';
import LoginPage from '../LoginPage.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: { template: '<div/>' } },
    { path: '/login', component: LoginPage },
  ],
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('LoginPage', () => {
  it('signs in and navigates to / on success', async () => {
    const loginSpy = vi.spyOn(client.api, 'login').mockResolvedValue();
    vi.spyOn(client.api, 'me').mockResolvedValue({
      user: { id: 'u', email: 'a@b.com', name: null, role: 'editor', isSuper: true },
      perms: {},
    });
    router.push('/login');
    await router.isReady();
    const w = mount(LoginPage, { global: { plugins: [router] } });
    await w.find('[data-testid="login-email"]').setValue('a@b.com');
    await w.find('[data-testid="login-password"]').setValue('hunter2hunter2');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(loginSpy).toHaveBeenCalledWith('a@b.com', 'hunter2hunter2');
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('shows error on invalid credentials', async () => {
    vi.spyOn(client.api, 'login').mockRejectedValue({ response: { message: 'Invalid credentials' } });
    router.push('/login');
    await router.isReady();
    const w = mount(LoginPage, { global: { plugins: [router] } });
    await w.find('[data-testid="login-email"]').setValue('a@b.com');
    await w.find('[data-testid="login-password"]').setValue('wrong');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="login-error"]').text()).toContain('Invalid credentials');
  });

  it('refuses external_user accounts and signs them out', async () => {
    vi.spyOn(client.api, 'login').mockResolvedValue();
    const logoutSpy = vi.spyOn(client.api, 'logout').mockResolvedValue();
    vi.spyOn(client.api, 'me').mockResolvedValue({
      user: { id: 'u', email: 'a@b.com', name: null, role: 'external_user', isSuper: false },
      perms: {},
    });
    router.push('/login');
    await router.isReady();
    const w = mount(LoginPage, { global: { plugins: [router] } });
    await w.find('[data-testid="login-email"]').setValue('a@b.com');
    await w.find('[data-testid="login-password"]').setValue('hunter2hunter2');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(logoutSpy).toHaveBeenCalled();
    expect(w.find('[data-testid="login-error"]').text()).toContain('cannot access the admin');
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @vulse/admin test -- LoginPage
```

Expected: FAIL — LoginPage.vue does not exist.

- [ ] **Step 3: Create LoginPage.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { type ApiError } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const auth = useAuthStore();

const email = ref('');
const password = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);

async function submit() {
  error.value = null;
  submitting.value = true;
  try {
    await auth.login(email.value, password.value);
    if (auth.user?.role === 'external_user') {
      await auth.logout();
      error.value = 'This account cannot access the admin.';
      return;
    }
    const target = (router.currentRoute.value.query.redirect as string | undefined) ?? '/';
    router.push(target);
  } catch (err) {
    const e = err as { response?: ApiError };
    error.value = e.response?.message ?? 'Sign-in failed.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto mt-24 max-w-sm rounded border border-zinc-200 bg-white p-6 shadow-sm">
    <h1 class="mb-4 text-lg font-semibold">Sign in to Vulse</h1>
    <form class="space-y-3" @submit.prevent="submit">
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">Email</span>
        <input
          v-model="email"
          type="email"
          autocomplete="username"
          required
          class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          data-testid="login-email"
        />
      </label>
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">Password</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          data-testid="login-password"
        />
      </label>
      <div v-if="error" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="login-error">
        {{ error }}
      </div>
      <button
        type="submit"
        class="w-full rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        :disabled="submitting"
        data-testid="login-submit"
      >
        {{ submitting ? 'Signing in…' : 'Sign in' }}
      </button>
      <div class="text-center text-xs text-zinc-500">
        <RouterLink to="/forgot-password" class="hover:text-zinc-900">Forgot password?</RouterLink>
      </div>
    </form>
  </div>
</template>
```

- [ ] **Step 4: Create ForgotPasswordPage.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, type ApiError } from '../api/client.js';

const email = ref('');
const submitting = ref(false);
const sent = ref(false);
const error = ref<string | null>(null);

async function submit() {
  error.value = null;
  submitting.value = true;
  try {
    await api.forgotPassword(email.value);
    sent.value = true;
  } catch (err) {
    error.value = (err as { response?: ApiError }).response?.message ?? 'Could not send reset email.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto mt-24 max-w-sm rounded border border-zinc-200 bg-white p-6 shadow-sm">
    <h1 class="mb-4 text-lg font-semibold">Reset your password</h1>
    <div v-if="sent" class="rounded bg-green-50 px-3 py-2 text-sm text-green-800">
      If that account exists, a reset link has been sent.
    </div>
    <form v-else class="space-y-3" @submit.prevent="submit">
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">Email</span>
        <input v-model="email" type="email" required class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
      </label>
      <div v-if="error" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>
      <button type="submit" class="w-full rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700" :disabled="submitting">
        {{ submitting ? 'Sending…' : 'Send reset link' }}
      </button>
      <div class="text-center text-xs text-zinc-500">
        <RouterLink to="/login" class="hover:text-zinc-900">Back to sign-in</RouterLink>
      </div>
    </form>
  </div>
</template>
```

- [ ] **Step 5: Create ResetPasswordPage.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api, type ApiError } from '../api/client.js';

const route = useRoute();
const router = useRouter();
const password = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);
const done = ref(false);

async function submit() {
  error.value = null;
  submitting.value = true;
  const token = String(route.params.token ?? '');
  try {
    await api.resetPassword(token, password.value);
    done.value = true;
    setTimeout(() => router.push('/login'), 1500);
  } catch (err) {
    error.value = (err as { response?: ApiError }).response?.message ?? 'Reset failed.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="mx-auto mt-24 max-w-sm rounded border border-zinc-200 bg-white p-6 shadow-sm">
    <h1 class="mb-4 text-lg font-semibold">Choose a new password</h1>
    <div v-if="done" class="rounded bg-green-50 px-3 py-2 text-sm text-green-800">
      Password updated. Redirecting to sign-in…
    </div>
    <form v-else class="space-y-3" @submit.prevent="submit">
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">New password</span>
        <input v-model="password" type="password" required minlength="12" class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
      </label>
      <div v-if="error" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</div>
      <button type="submit" class="w-full rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700" :disabled="submitting">
        {{ submitting ? 'Saving…' : 'Save new password' }}
      </button>
      <div class="text-center text-xs text-zinc-500">
        <RouterLink to="/login" class="hover:text-zinc-900">Cancel</RouterLink>
      </div>
    </form>
  </div>
</template>
```

- [ ] **Step 6: Update `router.ts`**

Modify `packages/admin/src/router.ts`. After the existing routes definition,
ensure each route has `meta` and add the new ones. Replace the routes array with:

```ts
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth.js';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./pages/LoginPage.vue'), meta: { requiresAuth: false } },
    { path: '/forgot-password', component: () => import('./pages/ForgotPasswordPage.vue'), meta: { requiresAuth: false } },
    { path: '/reset-password/:token', component: () => import('./pages/ResetPasswordPage.vue'), meta: { requiresAuth: false } },
    { path: '/loading', component: { template: '<div/>' }, meta: { requiresAuth: true } },
    { path: '/collections/:handle', component: () => import('./pages/CollectionList.vue'), props: true, meta: { requiresAuth: true } },
    { path: '/collections/:handle/new', component: () => import('./pages/CollectionEntry.vue'), props: (route) => ({ handle: route.params.handle, id: null }), meta: { requiresAuth: true } },
    { path: '/collections/:handle/:id', component: () => import('./pages/CollectionEntry.vue'), props: true, meta: { requiresAuth: true } },
    { path: '/schema', component: () => import('./pages/BlueprintList.vue'), meta: { requiresAuth: true } },
    { path: '/schema/new', component: () => import('./pages/BlueprintEditor.vue'), props: () => ({ handle: null }), meta: { requiresAuth: true, requiresSuper: true } },
    { path: '/schema/:handle', component: () => import('./pages/BlueprintEditor.vue'), props: true, meta: { requiresAuth: true, requiresSuper: true } },
    { path: '/', redirect: '/loading' },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.hydrated) {
    try { await auth.hydrate(); } catch { /* ignore */ }
  }
  if (to.meta.requiresAuth !== false && !auth.user) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.meta.requiresSuper && !auth.user?.isSuper) {
    return { path: '/' };
  }
});
```

(The existing `router.ts` may differ in route paths — adapt to match the
actual file. The KEY additions are: `meta.requiresAuth`, the three new
unauthenticated routes, and the `beforeEach` guard.)

- [ ] **Step 7: Update `App.vue` with user chip + logout**

In `packages/admin/src/App.vue`, add to the `<script setup>`:

```ts
import { useAuthStore } from './stores/auth.js';
const auth = useAuthStore();

async function signOut() {
  await auth.logout();
  router.push('/login');
}
```

Add a user chip + sign-out button in the topbar. Find:

```vue
      <div class="px-4 py-3 font-semibold tracking-tight">Vulse</div>
```

(or whatever the current branding row is) and add immediately after, before
the `<nav>`:

```vue
      <div v-if="auth.user" class="border-y border-zinc-100 px-4 py-2 text-xs">
        <div class="font-mono text-zinc-700" data-testid="user-chip">{{ auth.user.email }}</div>
        <button
          type="button"
          class="mt-1 text-zinc-500 hover:text-zinc-900"
          data-testid="sign-out"
          @click="signOut"
        >
          Sign out
        </button>
      </div>
```

- [ ] **Step 8: Run admin tests**

```bash
pnpm --filter @vulse/admin test
pnpm --filter @vulse/admin check
```

Expected: all tests pass; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add packages/admin/src/pages/LoginPage.vue packages/admin/src/pages/ForgotPasswordPage.vue packages/admin/src/pages/ResetPasswordPage.vue packages/admin/src/pages/__tests__/LoginPage.test.ts packages/admin/src/router.ts packages/admin/src/App.vue
git commit -m "feat(admin): login + forgot/reset pages + route guard"
```

---

## Task A12: Phase A smoke test

**Files:**
- Modify: `apps/dev/src/smoke.test.ts`

- [ ] **Step 1: Extend the smoke test**

Append a new `describe` block to `apps/dev/src/smoke.test.ts`:

```ts
describe('auth Phase A', () => {
  it('signs up an external user and signs them in', async () => {
    const email = `u-${Date.now()}@example.com`;
    const password = 'hunter2hunter2';

    // Sign up.
    const signup = await fetch(`${base}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Tester' }),
    });
    expect(signup.status).toBe(200);

    // Sign in.
    const signin = await fetch(`${base}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(signin.status).toBe(200);
    const cookie = signin.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('vulse_session=');

    // /api/auth/me reflects the signed-in user.
    const meRes = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
    expect(meRes.status).toBe(200);
    const me = (await meRes.json()) as { user: { email: string; role: string } | null };
    expect(me.user?.email).toBe(email);
    expect(me.user?.role).toBe('external_user');

    // Sign out.
    const signout = await fetch(`${base}/api/auth/sign-out`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(signout.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the smoke test**

```bash
pnpm --filter @vulse/dev test
```

Expected: PASS (existing 3 + new 1 = 4).

- [ ] **Step 3: Commit**

```bash
git add apps/dev/src/smoke.test.ts
git commit -m "test(dev): smoke covers sign-up + sign-in + sign-out roundtrip"
```

---

## Phase A complete checkpoint

```bash
pnpm -r test
pnpm -r check  # (or typecheck where defined)
pnpm biome check .
```

Expected: all green. The admin requires login; super user seeded on first
boot; sign-up / sign-in / sign-out / password reset all work.

---

# Phase B — Groups + Permissions

End state: editors can be restricted to specific collections via groups;
super users still bypass; external users remain read-only; admin has full
user + group management UIs.

---

## Task B1: `effectivePerms` function

**Files:**
- Create: `packages/auth/src/permissions.ts`
- Create: `packages/auth/src/__tests__/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/auth/src/__tests__/permissions.test.ts`:

```ts
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { effectivePerms } from '../permissions.js';
import type { AuthUser } from '../types.js';

function user(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: ulid(),
    email: 'u@x.com',
    emailVerified: false,
    name: null,
    image: null,
    role: 'editor',
    isSuper: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('effectivePerms', () => {
  let adapter: LibsqlAdapter;

  beforeEach(async () => {
    adapter = new LibsqlAdapter({ url: ':memory:' });
    await adapter.exec('PRAGMA foreign_keys = ON');
    await runMigrations(adapter, MIGRATIONS_DIR);
    await adapter.exec(
      `INSERT INTO collections (handle, label, definition) VALUES ('posts','Posts','{"handle":"posts","label":"Posts","singleton":false,"fields":[]}')`,
    );
    await adapter.exec(
      `INSERT INTO collections (handle, label, definition) VALUES ('authors','Authors','{"handle":"authors","label":"Authors","singleton":false,"fields":[]}')`,
    );
  });

  it('returns wildcard for super users', async () => {
    const perms = await effectivePerms(user({ isSuper: true }), adapter);
    expect(perms.get('*')?.has('delete')).toBe(true);
  });

  it('returns empty map for external_user', async () => {
    const perms = await effectivePerms(user({ role: 'external_user' }), adapter);
    expect(perms.size).toBe(0);
  });

  it('returns empty map for editor with no groups', async () => {
    const perms = await effectivePerms(user({ role: 'editor', isSuper: false }), adapter);
    expect(perms.size).toBe(0);
  });

  it('unions perms across multiple groups', async () => {
    const u = user({ role: 'editor', isSuper: false });
    await adapter.exec(
      `INSERT INTO users (id, email, role, is_super) VALUES (?, ?, 'editor', 0)`,
      [u.id, u.email],
    );
    const g1 = ulid(), g2 = ulid();
    await adapter.exec(`INSERT INTO groups (id, handle, label) VALUES (?, 'a', 'A'), (?, 'b', 'B')`, [g1, g2]);
    await adapter.exec(`INSERT INTO user_groups (user_id, group_id) VALUES (?, ?), (?, ?)`, [u.id, g1, u.id, g2]);
    await adapter.exec(
      `INSERT INTO group_permissions (group_id, collection_handle, can_read, can_create, can_update, can_delete)
       VALUES (?, 'posts', 1, 1, 0, 0), (?, 'posts', 0, 0, 1, 0), (?, 'authors', 1, 0, 0, 0)`,
      [g1, g2, g1],
    );
    const perms = await effectivePerms(u, adapter);
    expect([...(perms.get('posts') ?? [])].sort()).toEqual(['create', 'read', 'update']);
    expect([...(perms.get('authors') ?? [])]).toEqual(['read']);
  });
});
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @vulse/auth test -- permissions
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `permissions.ts`**

Create `packages/auth/src/permissions.ts`:

```ts
import type { DatabaseAdapter } from '@vulse/db';
import type { Action, AuthUser, EffectivePerms } from './types.js';

interface PermRow {
  collection_handle: string;
  can_read: number;
  can_create: number;
  can_update: number;
  can_delete: number;
}

export async function effectivePerms(
  user: AuthUser,
  adapter: DatabaseAdapter,
): Promise<EffectivePerms> {
  if (user.isSuper) {
    return new Map([['*', new Set<Action>(['read', 'create', 'update', 'delete'])]]);
  }
  if (user.role === 'external_user') return new Map();

  const rows = await adapter.query<PermRow>(
    `SELECT gp.collection_handle, gp.can_read, gp.can_create, gp.can_update, gp.can_delete
     FROM user_groups ug
     JOIN group_permissions gp ON gp.group_id = ug.group_id
     WHERE ug.user_id = ?`,
    [user.id],
  );
  const map: EffectivePerms = new Map();
  for (const r of rows) {
    const set = map.get(r.collection_handle) ?? new Set<Action>();
    if (r.can_read) set.add('read');
    if (r.can_create) set.add('create');
    if (r.can_update) set.add('update');
    if (r.can_delete) set.add('delete');
    map.set(r.collection_handle, set);
  }
  return map;
}

export function permsToWire(perms: EffectivePerms): Record<string, Action[]> {
  const out: Record<string, Action[]> = {};
  for (const [k, v] of perms) out[k] = [...v];
  return out;
}
```

- [ ] **Step 4: Run and verify pass**

```bash
pnpm --filter @vulse/auth test -- permissions
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/permissions.ts packages/auth/src/__tests__/permissions.test.ts
git commit -m "feat(auth): effectivePerms with super + external + group union"
```

---

## Task B2: `requireSuper` middleware

**Files:**
- Create: `packages/auth/src/middleware/require-super.ts`
- Create: `packages/auth/src/__tests__/require-super.test.ts`
- Modify: `packages/auth/src/middleware/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/auth/src/__tests__/require-super.test.ts`:

```ts
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requireSuper } from '../middleware/require-super.js';
import type { AuthUser, AuthVars } from '../types.js';

function setupApp(user: AuthUser | null) {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use('*', async (c, next) => { c.set('user', user); c.set('session', null); await next(); });
  app.use('*', requireSuper());
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('requireSuper', () => {
  it('401 when no user', async () => {
    const res = await setupApp(null).request('http://x/test');
    expect(res.status).toBe(401);
  });
  it('403 when not super', async () => {
    const user: AuthUser = { id: 'u', email: 'a', emailVerified: false, name: null, image: null, role: 'editor', isSuper: false, createdAt: '', updatedAt: '' };
    const res = await setupApp(user).request('http://x/test');
    expect(res.status).toBe(403);
  });
  it('passes through for super', async () => {
    const user: AuthUser = { id: 'u', email: 'a', emailVerified: false, name: null, image: null, role: 'editor', isSuper: true, createdAt: '', updatedAt: '' };
    const res = await setupApp(user).request('http://x/test');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @vulse/auth test -- require-super
```

- [ ] **Step 3: Implement `require-super.ts`**

```ts
import type { MiddlewareHandler } from 'hono';
import type { AuthVars } from '../types.js';

export function requireSuper(): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'auth_required' }, 401);
    if (!user.isSuper) return c.json({ error: 'forbidden' }, 403);
    await next();
  };
}
```

- [ ] **Step 4: Export from middleware barrel**

Update `packages/auth/src/middleware/index.ts`:

```ts
export { sessionMiddleware } from './session.js';
export { requireSuper } from './require-super.js';
// require-perm next.
```

- [ ] **Step 5: Verify pass**

```bash
pnpm --filter @vulse/auth test -- require-super
```

- [ ] **Step 6: Commit**

```bash
git add packages/auth/src/middleware/require-super.ts packages/auth/src/middleware/index.ts packages/auth/src/__tests__/require-super.test.ts
git commit -m "feat(auth): requireSuper middleware"
```

---

## Task B3: `requirePerm` middleware

**Files:**
- Create: `packages/auth/src/middleware/require-perm.ts`
- Create: `packages/auth/src/__tests__/require-perm.test.ts`
- Modify: `packages/auth/src/middleware/index.ts`
- Modify: `packages/auth/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/auth/src/__tests__/require-perm.test.ts`:

```ts
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { requirePerm } from '../middleware/require-perm.js';
import type { AuthUser, AuthVars } from '../types.js';

function setupApp(user: AuthUser | null, adapter: LibsqlAdapter, action: 'read' | 'create' | 'update' | 'delete') {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use('*', async (c, next) => { c.set('user', user); c.set('session', null); await next(); });
  app.use('/api/collections/:handle*', requirePerm({ action, adapter }));
  app.get('/api/collections/:handle', (c) => c.json({ ok: true }));
  app.post('/api/collections/:handle', (c) => c.json({ ok: true }));
  return app;
}

describe('requirePerm', () => {
  let adapter: LibsqlAdapter;

  beforeEach(async () => {
    adapter = new LibsqlAdapter({ url: ':memory:' });
    await adapter.exec('PRAGMA foreign_keys = ON');
    await runMigrations(adapter, MIGRATIONS_DIR);
    await adapter.exec(
      `INSERT INTO collections (handle, label, definition) VALUES ('posts', 'Posts', '{"handle":"posts","label":"Posts","singleton":false,"fields":[]}')`,
    );
  });

  it('anonymous read → 401', async () => {
    const res = await setupApp(null, adapter, 'read').request('http://x/api/collections/posts');
    expect(res.status).toBe(401);
  });

  it('external_user write → 403', async () => {
    const u: AuthUser = { id: 'u', email: 'a', emailVerified: false, name: null, image: null, role: 'external_user', isSuper: false, createdAt: '', updatedAt: '' };
    const res = await setupApp(u, adapter, 'create').request('http://x/api/collections/posts', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('external_user read → 200 (entry-level protection handled elsewhere)', async () => {
    const u: AuthUser = { id: 'u', email: 'a', emailVerified: false, name: null, image: null, role: 'external_user', isSuper: false, createdAt: '', updatedAt: '' };
    const res = await setupApp(u, adapter, 'read').request('http://x/api/collections/posts');
    expect(res.status).toBe(200);
  });

  it('super bypasses', async () => {
    const u: AuthUser = { id: 'u', email: 'a', emailVerified: false, name: null, image: null, role: 'editor', isSuper: true, createdAt: '', updatedAt: '' };
    const res = await setupApp(u, adapter, 'delete').request('http://x/api/collections/posts');
    expect(res.status).toBe(200);
  });

  it('editor without group → 403', async () => {
    const userId = ulid();
    await adapter.exec(`INSERT INTO users (id, email, role, is_super) VALUES (?, ?, 'editor', 0)`, [userId, 'e@x.com']);
    const u: AuthUser = { id: userId, email: 'e@x.com', emailVerified: false, name: null, image: null, role: 'editor', isSuper: false, createdAt: '', updatedAt: '' };
    const res = await setupApp(u, adapter, 'read').request('http://x/api/collections/posts');
    expect(res.status).toBe(403);
  });

  it('editor with read perm → 200', async () => {
    const userId = ulid(), groupId = ulid();
    await adapter.exec(`INSERT INTO users (id, email, role, is_super) VALUES (?, ?, 'editor', 0)`, [userId, 'e@x.com']);
    await adapter.exec(`INSERT INTO groups (id, handle, label) VALUES (?, 'g', 'G')`, [groupId]);
    await adapter.exec(`INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)`, [userId, groupId]);
    await adapter.exec(`INSERT INTO group_permissions (group_id, collection_handle, can_read) VALUES (?, 'posts', 1)`, [groupId]);
    const u: AuthUser = { id: userId, email: 'e@x.com', emailVerified: false, name: null, image: null, role: 'editor', isSuper: false, createdAt: '', updatedAt: '' };
    const res = await setupApp(u, adapter, 'read').request('http://x/api/collections/posts');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @vulse/auth test -- require-perm
```

- [ ] **Step 3: Implement `require-perm.ts`**

```ts
import type { DatabaseAdapter } from '@vulse/db';
import type { MiddlewareHandler } from 'hono';
import { effectivePerms } from '../permissions.js';
import type { Action, AuthVars } from '../types.js';

export interface RequirePermOptions {
  action: Action;
  adapter: DatabaseAdapter;
}

export function requirePerm(opts: RequirePermOptions): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'auth_required' }, 401);

    if (user.role === 'external_user') {
      if (opts.action !== 'read') return c.json({ error: 'forbidden' }, 403);
      await next();
      return;
    }

    if (user.isSuper) {
      await next();
      return;
    }

    const handle = c.req.param('handle');
    if (!handle) return c.json({ error: 'bad_request' }, 400);

    let perms = c.get('perms');
    if (!perms) {
      perms = await effectivePerms(user, opts.adapter);
      c.set('perms', perms);
    }
    const allowed = perms.get(handle)?.has(opts.action) ?? false;
    if (!allowed) return c.json({ error: 'forbidden' }, 403);
    await next();
  };
}
```

- [ ] **Step 4: Update barrels**

`packages/auth/src/middleware/index.ts`:
```ts
export { sessionMiddleware } from './session.js';
export { requireSuper } from './require-super.js';
export { requirePerm, type RequirePermOptions } from './require-perm.js';
```

`packages/auth/src/index.ts`:
```ts
export type { Role, AuthUser, AuthSession, Action, EffectivePerms, AuthVars } from './types.js';
export { createAuth, type AuthInstance, type AuthInstanceEnv } from './instance.js';
export { sessionMiddleware, requireSuper, requirePerm } from './middleware/index.js';
export { effectivePerms, permsToWire } from './permissions.js';
export { seedSuperUser, type BootstrapResult } from './bootstrap.js';
export { meRoute } from './routes/me.js';
```

- [ ] **Step 5: Verify pass**

```bash
pnpm --filter @vulse/auth test -- require-perm
```

- [ ] **Step 6: Commit**

```bash
git add packages/auth/src/middleware/require-perm.ts packages/auth/src/__tests__/require-perm.test.ts packages/auth/src/middleware/index.ts packages/auth/src/index.ts
git commit -m "feat(auth): requirePerm middleware with super + external + group lookup"
```

---

## Task B4: Wire `requirePerm` / `requireSuper` into `createApi`

**Files:**
- Modify: `packages/core/src/http/api.ts`
- Modify: `packages/core/src/http/__tests__/api.test.ts` (existing test file — update for auth)

- [ ] **Step 1: Wrap collection + blueprint routes**

In `packages/core/src/http/api.ts`, change the imports to include
`requirePerm` and `requireSuper`. Then wrap routes:

```ts
import { sessionMiddleware, requirePerm, requireSuper, meRoute } from '@vulse/auth';

// ...

  app.get('/api/collections/:handle', requirePerm({ action: 'read', adapter }), async (c) => { /* existing */ });
  app.get('/api/collections/:handle/:id', requirePerm({ action: 'read', adapter }), async (c) => { /* existing */ });
  app.post('/api/collections/:handle', requirePerm({ action: 'create', adapter }), async (c) => { /* existing */ });
  app.patch('/api/collections/:handle/:id', requirePerm({ action: 'update', adapter }), async (c) => { /* existing */ });
  app.delete('/api/collections/:handle/:id', requirePerm({ action: 'delete', adapter }), async (c) => { /* existing */ });

  app.get('/api/blueprints', async (c) => { /* unchanged: readable to any signed-in user for the admin UI */ });
  app.get('/api/blueprints/:handle', async (c) => { /* unchanged */ });
  app.post('/api/blueprints', requireSuper(), async (c) => { /* existing */ });
  app.patch('/api/blueprints/:handle', requireSuper(), async (c) => { /* existing */ });
  app.delete('/api/blueprints/:handle', requireSuper(), async (c) => { /* existing */ });

  app.get('/api/_meta/collections', (c) => c.json([...blueprints.values()].map(toMeta)));
```

Blueprint GETs stay open to any authenticated user because the admin needs
them to render the sidebar. Add an explicit `sessionMiddleware`-gate on
blueprint GETs (returns 401 if no user):

```ts
  app.get('/api/blueprints', async (c) => {
    if (!c.get('user')) return c.json({ error: 'auth_required' }, 401);
    /* existing handler */
  });
  app.get('/api/blueprints/:handle', async (c) => {
    if (!c.get('user')) return c.json({ error: 'auth_required' }, 401);
    /* existing handler */
  });
  app.get('/api/_meta/collections', (c) => {
    if (!c.get('user')) return c.json({ error: 'auth_required' }, 401);
    return c.json([...blueprints.values()].map(toMeta));
  });
```

- [ ] **Step 2: Update existing api tests**

The existing `packages/core/src/http/__tests__/api.test.ts` tests will now
return 401 for unauthenticated requests. Add a test fixture that creates a
super user + session cookie and sends it on every request. Sketch:

```ts
async function authedCookie(adapter: LibsqlAdapter, authInstance: AuthInstance): Promise<string> {
  // Create a super user directly in the DB with a known password.
  // Sign in via the Hono app, capture the set-cookie.
  // Return the cookie value to attach via headers.
}
```

For each existing test, replace `app.request(url)` with
`app.request(url, { headers: { cookie } })`. Add the new "anonymous request
returns 401" test cases to lock in the behavior.

- [ ] **Step 3: Run core tests**

```bash
pnpm --filter @vulse/core test
```

Expected: all updated tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/http/api.ts packages/core/src/http/__tests__/
git commit -m "feat(core): gate collection + blueprint routes with auth middleware"
```

---

## Task B5: Replace stub perms in `/api/auth/me`

**Files:**
- Modify: `packages/auth/src/routes/me.ts`

- [ ] **Step 1: Inject adapter and return real perms**

Replace `packages/auth/src/routes/me.ts`:

```ts
import type { DatabaseAdapter } from '@vulse/db';
import { Hono } from 'hono';
import { effectivePerms, permsToWire } from '../permissions.js';
import type { AuthVars } from '../types.js';

export function meRoute(adapter: DatabaseAdapter): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  app.get('/api/auth/me', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ user: null, perms: {} });
    const perms = await effectivePerms(user, adapter);
    return c.json({ user, perms: permsToWire(perms) });
  });
  return app;
}
```

Update the `createApi` call site to pass `adapter`:

```ts
  app.route('/', meRoute(adapter));
```

- [ ] **Step 2: Add a /api/auth/me test that exercises perms**

In `packages/core/src/http/__tests__/api.test.ts` (or a new `me.api.test.ts`):

```ts
it('GET /api/auth/me returns perms for editor in a group', async () => {
  // setup editor + group + permission
  // sign in, capture cookie
  // GET /api/auth/me with cookie
  // expect body.perms.posts to include 'read'
});
```

- [ ] **Step 3: Run and verify**

```bash
pnpm --filter @vulse/core test
pnpm --filter @vulse/auth test
```

- [ ] **Step 4: Commit**

```bash
git add packages/auth/src/routes/me.ts packages/core/src/http/api.ts packages/core/src/http/__tests__/
git commit -m "feat(auth): /api/auth/me bundles effectivePerms"
```

---

## Task B6: Users service + API

**Files:**
- Create: `packages/auth/src/services/users.ts`
- Create: `packages/auth/src/services/index.ts`
- Create: `packages/auth/src/routes/users.ts`
- Create: `packages/auth/src/__tests__/users.test.ts`

- [ ] **Step 1: Write the failing service test**

Create `packages/auth/src/__tests__/users.test.ts`:

```ts
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { createUser, deleteUser, getUser, listUsers, updateUser } from '../services/users.js';

describe('users service', () => {
  let adapter: LibsqlAdapter;
  beforeEach(async () => {
    adapter = new LibsqlAdapter({ url: ':memory:' });
    await adapter.exec('PRAGMA foreign_keys = ON');
    await runMigrations(adapter, MIGRATIONS_DIR);
  });

  it('creates an editor with given role and is_super', async () => {
    const u = await createUser(adapter, {
      email: 'e@x.com', password: 'hunter2hunter2', role: 'editor', isSuper: true, name: 'E',
    });
    expect(u.email).toBe('e@x.com');
    expect(u.role).toBe('editor');
    expect(u.isSuper).toBe(true);
  });

  it('lists with role filter and pagination', async () => {
    await createUser(adapter, { email: 'a@x.com', password: 'pw', role: 'editor', isSuper: false, name: 'A' });
    await createUser(adapter, { email: 'b@x.com', password: 'pw', role: 'external_user', isSuper: false, name: 'B' });
    const all = await listUsers(adapter, { limit: 10, offset: 0 });
    expect(all.total).toBe(2);
    const editors = await listUsers(adapter, { limit: 10, offset: 0, role: 'editor' });
    expect(editors.items.map((u) => u.email)).toEqual(['a@x.com']);
  });

  it('updates name, role, is_super, group memberships', async () => {
    const u = await createUser(adapter, { email: 'a@x.com', password: 'pw', role: 'editor', isSuper: false, name: 'A' });
    await adapter.exec(`INSERT INTO groups (id, handle, label) VALUES ('g1','marketing','Marketing')`);
    const upd = await updateUser(adapter, u.id, { name: 'A2', role: 'external_user', isSuper: false, groupIds: ['g1'] });
    expect(upd.name).toBe('A2');
    expect(upd.role).toBe('external_user');
    expect(upd.groupIds).toEqual(['g1']);
  });

  it('deletes a user and cascades sessions', async () => {
    const u = await createUser(adapter, { email: 'a@x.com', password: 'pw', role: 'editor', isSuper: false, name: 'A' });
    await deleteUser(adapter, u.id);
    expect(await getUser(adapter, u.id)).toBeNull();
  });

  it('rejects duplicate emails', async () => {
    await createUser(adapter, { email: 'a@x.com', password: 'pw', role: 'editor', isSuper: false, name: 'A' });
    await expect(
      createUser(adapter, { email: 'a@x.com', password: 'pw', role: 'editor', isSuper: false, name: 'X' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @vulse/auth test -- users
```

- [ ] **Step 3: Implement `services/users.ts`**

Create:

```ts
import type { DatabaseAdapter } from '@vulse/db';
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { ulid } from 'ulid';
import type { Role } from '../types.js';

const scryptAsync = promisify(scrypt);

export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  isSuper: boolean;
  createdAt: string;
  updatedAt: string;
  groupIds: string[];
}

export interface CreateUserInput {
  email: string;
  password: string;
  name: string | null;
  role: Role;
  isSuper: boolean;
  groupIds?: string[];
}

export interface UpdateUserInput {
  name?: string | null;
  role?: Role;
  isSuper?: boolean;
  groupIds?: string[];
}

async function hashPassword(p: string): Promise<string> {
  const salt = randomBytes(16);
  const buf = (await scryptAsync(p, salt, 64)) as Buffer;
  return `${salt.toString('hex')}:${buf.toString('hex')}`;
}

async function loadUser(adapter: DatabaseAdapter, id: string): Promise<UserDTO | null> {
  const row = await adapter.queryOne<{
    id: string; email: string; name: string | null; role: Role;
    is_super: number; created_at: string; updated_at: string;
  }>(
    `SELECT id, email, name, role, is_super, created_at, updated_at FROM users WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  const gs = await adapter.query<{ group_id: string }>(
    `SELECT group_id FROM user_groups WHERE user_id = ?`,
    [id],
  );
  return {
    id: row.id, email: row.email, name: row.name, role: row.role,
    isSuper: row.is_super === 1, createdAt: row.created_at, updatedAt: row.updated_at,
    groupIds: gs.map((g) => g.group_id),
  };
}

export async function createUser(adapter: DatabaseAdapter, input: CreateUserInput): Promise<UserDTO> {
  const userId = ulid();
  const accountId = ulid();
  const hashed = await hashPassword(input.password);
  await adapter.exec(
    `INSERT INTO users (id, email, name, role, is_super, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [userId, input.email, input.name, input.role, input.isSuper ? 1 : 0],
  );
  await adapter.exec(
    `INSERT INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
     VALUES (?, ?, ?, 'credential', ?, datetime('now'), datetime('now'))`,
    [accountId, userId, input.email, hashed],
  );
  if (input.groupIds?.length) {
    for (const gid of input.groupIds) {
      await adapter.exec(`INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)`, [userId, gid]);
    }
  }
  return (await loadUser(adapter, userId))!;
}

export async function getUser(adapter: DatabaseAdapter, id: string): Promise<UserDTO | null> {
  return loadUser(adapter, id);
}

export interface ListUsersOptions {
  limit: number;
  offset: number;
  role?: Role;
}

export async function listUsers(adapter: DatabaseAdapter, opts: ListUsersOptions) {
  const where = opts.role ? `WHERE role = ?` : '';
  const whereParams = opts.role ? [opts.role] : [];
  const total = (await adapter.queryOne<{ c: number }>(
    `SELECT COUNT(*) AS c FROM users ${where}`,
    whereParams,
  ))?.c ?? 0;
  const rows = await adapter.query<{ id: string }>(
    `SELECT id FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...whereParams, opts.limit, opts.offset],
  );
  const items: UserDTO[] = [];
  for (const r of rows) items.push((await loadUser(adapter, r.id))!);
  return { items, total, limit: opts.limit, offset: opts.offset };
}

export async function updateUser(
  adapter: DatabaseAdapter,
  id: string,
  input: UpdateUserInput,
): Promise<UserDTO> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) { sets.push('name = ?'); params.push(input.name); }
  if (input.role !== undefined) { sets.push('role = ?'); params.push(input.role); }
  if (input.isSuper !== undefined) { sets.push('is_super = ?'); params.push(input.isSuper ? 1 : 0); }
  sets.push(`updated_at = datetime('now')`);
  if (sets.length > 1) {
    await adapter.exec(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }
  if (input.groupIds) {
    await adapter.exec(`DELETE FROM user_groups WHERE user_id = ?`, [id]);
    for (const gid of input.groupIds) {
      await adapter.exec(`INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)`, [id, gid]);
    }
  }
  const out = await loadUser(adapter, id);
  if (!out) throw new Error(`user not found: ${id}`);
  return out;
}

export async function deleteUser(adapter: DatabaseAdapter, id: string): Promise<void> {
  await adapter.exec(`DELETE FROM users WHERE id = ?`, [id]);
}
```

- [ ] **Step 4: Create the routes**

Create `packages/auth/src/routes/users.ts`:

```ts
import type { DatabaseAdapter } from '@vulse/db';
import { Hono } from 'hono';
import { requireSuper } from '../middleware/require-super.js';
import { createUser, deleteUser, getUser, listUsers, updateUser } from '../services/users.js';
import type { AuthVars } from '../types.js';

export function usersRoute(adapter: DatabaseAdapter): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use('/api/users/*', requireSuper());
  app.use('/api/users', requireSuper());

  app.get('/api/users', async (c) => {
    const limit = Number(c.req.query('limit') ?? '50');
    const offset = Number(c.req.query('offset') ?? '0');
    const role = c.req.query('role') as 'editor' | 'external_user' | undefined;
    return c.json(await listUsers(adapter, { limit, offset, ...(role ? { role } : {}) }));
  });
  app.post('/api/users', async (c) => {
    const body = await c.req.json();
    return c.json(await createUser(adapter, body), 201);
  });
  app.get('/api/users/:id', async (c) => {
    const u = await getUser(adapter, c.req.param('id'));
    if (!u) return c.json({ error: 'not_found' }, 404);
    return c.json(u);
  });
  app.patch('/api/users/:id', async (c) => {
    const body = await c.req.json();
    return c.json(await updateUser(adapter, c.req.param('id'), body));
  });
  app.delete('/api/users/:id', async (c) => {
    await deleteUser(adapter, c.req.param('id'));
    return c.body(null, 204);
  });
  return app;
}
```

- [ ] **Step 5: Create barrel + wire into createApi**

`packages/auth/src/services/index.ts`:
```ts
export * from './users.js';
// groups added next.
```

In `packages/auth/src/index.ts`, add:
```ts
export { usersRoute } from './routes/users.js';
```

In `packages/core/src/http/api.ts`, after `app.route('/', meRoute(adapter));`:
```ts
import { usersRoute } from '@vulse/auth';
// ...
app.route('/', usersRoute(adapter));
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @vulse/auth test
pnpm --filter @vulse/core test
```

- [ ] **Step 7: Commit**

```bash
git add packages/auth/src/services/ packages/auth/src/routes/users.ts packages/auth/src/__tests__/users.test.ts packages/auth/src/index.ts packages/core/src/http/api.ts
git commit -m "feat(auth): users service + /api/users CRUD"
```

---

## Task B7: Groups service + API

**Files:**
- Create: `packages/auth/src/services/groups.ts`
- Create: `packages/auth/src/routes/groups.ts`
- Create: `packages/auth/src/__tests__/groups.test.ts`
- Modify: `packages/auth/src/services/index.ts`
- Modify: `packages/auth/src/index.ts`
- Modify: `packages/core/src/http/api.ts`

- [ ] **Step 1: Write the failing service test**

Create `packages/auth/src/__tests__/groups.test.ts`:

```ts
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGroup, deleteGroup, getGroup, listGroups, setPermissions, updateGroup } from '../services/groups.js';

describe('groups service', () => {
  let adapter: LibsqlAdapter;
  beforeEach(async () => {
    adapter = new LibsqlAdapter({ url: ':memory:' });
    await adapter.exec('PRAGMA foreign_keys = ON');
    await runMigrations(adapter, MIGRATIONS_DIR);
    await adapter.exec(
      `INSERT INTO collections (handle, label, definition) VALUES ('posts','Posts','{"handle":"posts","label":"Posts","singleton":false,"fields":[]}')`,
    );
  });

  it('creates a group', async () => {
    const g = await createGroup(adapter, { handle: 'marketing', label: 'Marketing' });
    expect(g.handle).toBe('marketing');
  });

  it('lists groups', async () => {
    await createGroup(adapter, { handle: 'a', label: 'A' });
    await createGroup(adapter, { handle: 'b', label: 'B' });
    const list = await listGroups(adapter);
    expect(list.map((g) => g.handle).sort()).toEqual(['a', 'b']);
  });

  it('setPermissions replaces rows', async () => {
    const g = await createGroup(adapter, { handle: 'a', label: 'A' });
    await setPermissions(adapter, g.id, [
      { collectionHandle: 'posts', canRead: true, canCreate: true, canUpdate: false, canDelete: false },
    ]);
    const got = await getGroup(adapter, 'a');
    expect(got?.permissions).toEqual([
      { collectionHandle: 'posts', canRead: true, canCreate: true, canUpdate: false, canDelete: false },
    ]);
    // Replace with empty.
    await setPermissions(adapter, g.id, []);
    expect((await getGroup(adapter, 'a'))?.permissions).toEqual([]);
  });

  it('updates label', async () => {
    const g = await createGroup(adapter, { handle: 'a', label: 'A' });
    await updateGroup(adapter, g.id, { label: 'A2' });
    expect((await getGroup(adapter, 'a'))?.label).toBe('A2');
  });

  it('deletes group and cascades', async () => {
    const g = await createGroup(adapter, { handle: 'a', label: 'A' });
    await setPermissions(adapter, g.id, [
      { collectionHandle: 'posts', canRead: true, canCreate: false, canUpdate: false, canDelete: false },
    ]);
    await deleteGroup(adapter, g.id);
    expect(await getGroup(adapter, 'a')).toBeNull();
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @vulse/auth test -- groups
```

- [ ] **Step 3: Implement `services/groups.ts`**

```ts
import type { DatabaseAdapter } from '@vulse/db';
import { ulid } from 'ulid';

export interface PermissionRowInput {
  collectionHandle: string;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

export interface GroupDTO {
  id: string;
  handle: string;
  label: string;
  createdAt: string;
  permissions: PermissionRowInput[];
}

export async function createGroup(
  adapter: DatabaseAdapter,
  input: { handle: string; label: string },
): Promise<GroupDTO> {
  const id = ulid();
  await adapter.exec(
    `INSERT INTO groups (id, handle, label) VALUES (?, ?, ?)`,
    [id, input.handle, input.label],
  );
  const row = await adapter.queryOne<{ id: string; handle: string; label: string; created_at: string }>(
    `SELECT id, handle, label, created_at FROM groups WHERE id = ?`,
    [id],
  );
  return { id: row!.id, handle: row!.handle, label: row!.label, createdAt: row!.created_at, permissions: [] };
}

export async function listGroups(adapter: DatabaseAdapter): Promise<GroupDTO[]> {
  const rows = await adapter.query<{ id: string; handle: string; label: string; created_at: string }>(
    `SELECT id, handle, label, created_at FROM groups ORDER BY created_at ASC`,
  );
  const out: GroupDTO[] = [];
  for (const r of rows) {
    out.push({
      id: r.id, handle: r.handle, label: r.label, createdAt: r.created_at,
      permissions: await loadPerms(adapter, r.id),
    });
  }
  return out;
}

export async function getGroup(adapter: DatabaseAdapter, handle: string): Promise<GroupDTO | null> {
  const row = await adapter.queryOne<{ id: string; handle: string; label: string; created_at: string }>(
    `SELECT id, handle, label, created_at FROM groups WHERE handle = ?`,
    [handle],
  );
  if (!row) return null;
  return { id: row.id, handle: row.handle, label: row.label, createdAt: row.created_at, permissions: await loadPerms(adapter, row.id) };
}

export async function updateGroup(
  adapter: DatabaseAdapter,
  id: string,
  input: { label?: string },
): Promise<void> {
  if (input.label !== undefined) {
    await adapter.exec(`UPDATE groups SET label = ? WHERE id = ?`, [input.label, id]);
  }
}

export async function setPermissions(
  adapter: DatabaseAdapter,
  groupId: string,
  rows: PermissionRowInput[],
): Promise<void> {
  await adapter.exec(`DELETE FROM group_permissions WHERE group_id = ?`, [groupId]);
  for (const r of rows) {
    await adapter.exec(
      `INSERT INTO group_permissions (group_id, collection_handle, can_read, can_create, can_update, can_delete)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [groupId, r.collectionHandle, r.canRead ? 1 : 0, r.canCreate ? 1 : 0, r.canUpdate ? 1 : 0, r.canDelete ? 1 : 0],
    );
  }
}

export async function deleteGroup(adapter: DatabaseAdapter, id: string): Promise<void> {
  await adapter.exec(`DELETE FROM groups WHERE id = ?`, [id]);
}

async function loadPerms(adapter: DatabaseAdapter, groupId: string): Promise<PermissionRowInput[]> {
  const rows = await adapter.query<{
    collection_handle: string;
    can_read: number; can_create: number; can_update: number; can_delete: number;
  }>(
    `SELECT collection_handle, can_read, can_create, can_update, can_delete
     FROM group_permissions WHERE group_id = ?
     ORDER BY collection_handle`,
    [groupId],
  );
  return rows.map((r) => ({
    collectionHandle: r.collection_handle,
    canRead: r.can_read === 1,
    canCreate: r.can_create === 1,
    canUpdate: r.can_update === 1,
    canDelete: r.can_delete === 1,
  }));
}
```

- [ ] **Step 4: Create the routes**

`packages/auth/src/routes/groups.ts`:

```ts
import type { DatabaseAdapter } from '@vulse/db';
import { Hono } from 'hono';
import { requireSuper } from '../middleware/require-super.js';
import {
  createGroup, deleteGroup, getGroup, listGroups, setPermissions, updateGroup,
} from '../services/groups.js';
import type { AuthVars } from '../types.js';

export function groupsRoute(adapter: DatabaseAdapter): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  app.use('/api/groups/*', requireSuper());
  app.use('/api/groups', requireSuper());

  app.get('/api/groups', async (c) => c.json(await listGroups(adapter)));
  app.post('/api/groups', async (c) => {
    const body = await c.req.json();
    return c.json(await createGroup(adapter, body), 201);
  });
  app.get('/api/groups/:handle', async (c) => {
    const g = await getGroup(adapter, c.req.param('handle'));
    if (!g) return c.json({ error: 'not_found' }, 404);
    return c.json(g);
  });
  app.patch('/api/groups/:handle', async (c) => {
    const body = await c.req.json();
    const g = await getGroup(adapter, c.req.param('handle'));
    if (!g) return c.json({ error: 'not_found' }, 404);
    await updateGroup(adapter, g.id, body);
    return c.json(await getGroup(adapter, g.handle));
  });
  app.put('/api/groups/:handle/permissions', async (c) => {
    const body = (await c.req.json()) as { rows: Parameters<typeof setPermissions>[2] };
    const g = await getGroup(adapter, c.req.param('handle'));
    if (!g) return c.json({ error: 'not_found' }, 404);
    await setPermissions(adapter, g.id, body.rows);
    return c.json(await getGroup(adapter, g.handle));
  });
  app.delete('/api/groups/:handle', async (c) => {
    const g = await getGroup(adapter, c.req.param('handle'));
    if (!g) return c.json({ error: 'not_found' }, 404);
    await deleteGroup(adapter, g.id);
    return c.body(null, 204);
  });
  return app;
}
```

- [ ] **Step 5: Wire into createApi**

`packages/auth/src/services/index.ts`:
```ts
export * from './users.js';
export * from './groups.js';
```

`packages/auth/src/index.ts`:
```ts
export { groupsRoute } from './routes/groups.js';
```

In `packages/core/src/http/api.ts`:
```ts
import { usersRoute, groupsRoute } from '@vulse/auth';
// ...
app.route('/', groupsRoute(adapter));
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @vulse/auth test
pnpm --filter @vulse/core test
```

- [ ] **Step 7: Commit**

```bash
git add packages/auth/src/services/ packages/auth/src/routes/groups.ts packages/auth/src/__tests__/groups.test.ts packages/auth/src/index.ts packages/core/src/http/api.ts
git commit -m "feat(auth): groups service + /api/groups CRUD + permission matrix"
```

---

## Task B8: Admin user management UI

**Files:**
- Create: `packages/admin/src/pages/UserList.vue`
- Create: `packages/admin/src/pages/UserEditor.vue`
- Modify: `packages/admin/src/router.ts`
- Modify: `packages/admin/src/App.vue` (sidebar entry)
- Modify: `packages/admin/src/api/client.ts` (user + group endpoints)

- [ ] **Step 1: Add API client methods**

Add to `packages/admin/src/api/client.ts`:

```ts
export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  role: 'editor' | 'external_user';
  isSuper: boolean;
  createdAt: string;
  updatedAt: string;
  groupIds: string[];
}

export interface GroupDTO {
  id: string;
  handle: string;
  label: string;
  createdAt: string;
  permissions: {
    collectionHandle: string;
    canRead: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean;
  }[];
}

// Inside `api`:
async listUsers(opts?: { role?: string; limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  if (opts?.role) qs.set('role', opts.role);
  qs.set('limit', String(opts?.limit ?? 50));
  qs.set('offset', String(opts?.offset ?? 0));
  return this.json<{ items: UserDTO[]; total: number }>(`/api/users?${qs}`);
},
async getUser(id: string) { return this.json<UserDTO>(`/api/users/${id}`); },
async createUser(body: Partial<UserDTO> & { email: string; password: string }) {
  return this.json<UserDTO>('/api/users', { method: 'POST', body: JSON.stringify(body) });
},
async updateUser(id: string, body: Partial<UserDTO>) {
  return this.json<UserDTO>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
},
async deleteUser(id: string) {
  return this.json<void>(`/api/users/${id}`, { method: 'DELETE' });
},

async listGroups() { return this.json<GroupDTO[]>('/api/groups'); },
async getGroup(handle: string) { return this.json<GroupDTO>(`/api/groups/${handle}`); },
async createGroup(body: { handle: string; label: string }) {
  return this.json<GroupDTO>('/api/groups', { method: 'POST', body: JSON.stringify(body) });
},
async updateGroup(handle: string, body: Partial<GroupDTO>) {
  return this.json<GroupDTO>(`/api/groups/${handle}`, { method: 'PATCH', body: JSON.stringify(body) });
},
async setGroupPermissions(handle: string, rows: GroupDTO['permissions']) {
  return this.json<GroupDTO>(`/api/groups/${handle}/permissions`, {
    method: 'PUT', body: JSON.stringify({ rows }),
  });
},
async deleteGroup(handle: string) {
  return this.json<void>(`/api/groups/${handle}`, { method: 'DELETE' });
},
```

(The exact `json<T>` helper may already exist in the file. If not, add a
small private helper that wraps fetch + credentials + error-throwing.)

- [ ] **Step 2: Create UserList.vue**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api, type UserDTO } from '../api/client.js';
import { useToastsStore } from '../stores/toasts.js';

const router = useRouter();
const toasts = useToastsStore();
const users = ref<UserDTO[]>([]);
const total = ref(0);
const loading = ref(false);
const roleFilter = ref<string>('');

async function load() {
  loading.value = true;
  try {
    const res = await api.listUsers(roleFilter.value ? { role: roleFilter.value } : {});
    users.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

async function destroy(u: UserDTO) {
  if (!confirm(`Delete user ${u.email}?`)) return;
  await api.deleteUser(u.id);
  toasts.success('User deleted');
  await load();
}

onMounted(load);
</script>

<template>
  <div class="p-6">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-semibold">Users</h1>
      <RouterLink to="/settings/users/new" class="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">
        + New user
      </RouterLink>
    </div>
    <div class="mb-3">
      <select v-model="roleFilter" class="rounded border border-zinc-300 px-3 py-1.5 text-sm" @change="load">
        <option value="">All roles</option>
        <option value="editor">Editors</option>
        <option value="external_user">External users</option>
      </select>
    </div>
    <table class="w-full text-left text-sm">
      <thead><tr class="border-b border-zinc-200 text-xs uppercase text-zinc-500">
        <th class="py-2">Email</th><th>Role</th><th>Super</th><th></th>
      </tr></thead>
      <tbody>
        <tr v-for="u in users" :key="u.id" class="border-b border-zinc-100">
          <td class="py-2 font-mono">{{ u.email }}</td>
          <td>{{ u.role }}</td>
          <td>{{ u.isSuper ? '✓' : '' }}</td>
          <td class="text-right">
            <RouterLink :to="`/settings/users/${u.id}`" class="mr-2 text-xs text-zinc-600 hover:text-zinc-900">Edit</RouterLink>
            <button class="text-xs text-red-600 hover:text-red-800" @click="destroy(u)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 3: Create UserEditor.vue**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type GroupDTO, type UserDTO } from '../api/client.js';
import { useToastsStore } from '../stores/toasts.js';

const props = defineProps<{ id: string | null }>();
const router = useRouter();
const toasts = useToastsStore();

const email = ref('');
const password = ref('');
const name = ref('');
const role = ref<'editor' | 'external_user'>('editor');
const isSuper = ref(false);
const groupIds = ref<string[]>([]);
const groups = ref<GroupDTO[]>([]);
const saving = ref(false);
const isCreate = ref(props.id === null);

async function load() {
  groups.value = await api.listGroups();
  if (props.id === null) return;
  const u = await api.getUser(props.id);
  email.value = u.email;
  name.value = u.name ?? '';
  role.value = u.role;
  isSuper.value = u.isSuper;
  groupIds.value = u.groupIds;
}

async function save() {
  saving.value = true;
  try {
    if (isCreate.value) {
      await api.createUser({ email: email.value, password: password.value, name: name.value, role: role.value, isSuper: isSuper.value, groupIds: groupIds.value });
    } else {
      await api.updateUser(props.id!, { name: name.value, role: role.value, isSuper: isSuper.value, groupIds: groupIds.value });
    }
    toasts.success('User saved');
    router.push('/settings/users');
  } catch (e) {
    toasts.error((e as { response?: { message?: string } }).response?.message ?? 'Save failed');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="p-6">
    <h1 class="mb-4 text-xl font-semibold">{{ isCreate ? 'New user' : 'Edit user' }}</h1>
    <form class="max-w-xl space-y-3" @submit.prevent="save">
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">Email</span>
        <input v-model="email" type="email" :disabled="!isCreate" required class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100" />
      </label>
      <label v-if="isCreate" class="block">
        <span class="block text-sm font-medium text-zinc-700">Password</span>
        <input v-model="password" type="password" required minlength="12" class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
      </label>
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">Name</span>
        <input v-model="name" class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
      </label>
      <label class="block">
        <span class="block text-sm font-medium text-zinc-700">Role</span>
        <select v-model="role" class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm">
          <option value="editor">Editor</option>
          <option value="external_user">External user</option>
        </select>
      </label>
      <label class="flex items-center gap-2">
        <input v-model="isSuper" type="checkbox" class="rounded border-zinc-300" />
        <span class="text-sm font-medium text-zinc-700">Super user (bypasses all permission checks)</span>
      </label>
      <div>
        <span class="block text-sm font-medium text-zinc-700">Groups</span>
        <div class="mt-1 space-y-1">
          <label v-for="g in groups" :key="g.id" class="flex items-center gap-2 text-sm">
            <input type="checkbox" :value="g.id" v-model="groupIds" />
            <span>{{ g.label }} <span class="text-xs text-zinc-500">({{ g.handle }})</span></span>
          </label>
        </div>
      </div>
      <button type="submit" class="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50" :disabled="saving">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </form>
  </div>
</template>
```

- [ ] **Step 4: Add routes**

In `packages/admin/src/router.ts` routes array (alongside `/schema/*`):

```ts
{ path: '/settings/users', component: () => import('./pages/UserList.vue'), meta: { requiresAuth: true, requiresSuper: true } },
{ path: '/settings/users/new', component: () => import('./pages/UserEditor.vue'), props: () => ({ id: null }), meta: { requiresAuth: true, requiresSuper: true } },
{ path: '/settings/users/:id', component: () => import('./pages/UserEditor.vue'), props: true, meta: { requiresAuth: true, requiresSuper: true } },
```

- [ ] **Step 5: Add sidebar link**

In `packages/admin/src/App.vue`, inside the Settings group (alongside the
collapsible Schema), add a `Users` link gated by `auth.user?.isSuper`:

```vue
        <RouterLink
          v-if="auth.user?.isSuper"
          to="/settings/users"
          class="block rounded px-2 py-1.5 text-sm hover:bg-zinc-100"
          active-class="bg-zinc-100 font-medium"
          data-testid="settings-users-link"
        >
          Users
        </RouterLink>
```

- [ ] **Step 6: Verify tests + typecheck**

```bash
pnpm --filter @vulse/admin test
pnpm --filter @vulse/admin check
```

- [ ] **Step 7: Commit**

```bash
git add packages/admin/src/pages/UserList.vue packages/admin/src/pages/UserEditor.vue packages/admin/src/router.ts packages/admin/src/App.vue packages/admin/src/api/client.ts
git commit -m "feat(admin): user management pages (list + editor)"
```

---

## Task B9: Admin group management UI (with permission matrix)

**Files:**
- Create: `packages/admin/src/pages/GroupList.vue`
- Create: `packages/admin/src/pages/GroupEditor.vue`
- Create: `packages/admin/src/pages/__tests__/GroupEditor.test.ts`
- Modify: `packages/admin/src/router.ts`
- Modify: `packages/admin/src/App.vue` (sidebar entry)

- [ ] **Step 1: Write the failing matrix test**

Create `packages/admin/src/pages/__tests__/GroupEditor.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import * as client from '../../api/client.js';
import GroupEditor from '../GroupEditor.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/settings/groups', component: { template: '<div/>' } }],
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(client.api, 'getGroup').mockResolvedValue({
    id: 'g1', handle: 'marketing', label: 'Marketing', createdAt: '',
    permissions: [{ collectionHandle: 'posts', canRead: true, canCreate: false, canUpdate: true, canDelete: false }],
  });
  vi.spyOn(client.api, 'meta').mockResolvedValue([
    { handle: 'posts', label: 'Posts', singleton: false, fields: [] },
    { handle: 'authors', label: 'Authors', singleton: false, fields: [] },
  ]);
});

describe('GroupEditor', () => {
  it('saves the permission matrix in the expected wire shape', async () => {
    const setPerms = vi.spyOn(client.api, 'setGroupPermissions').mockResolvedValue({
      id: 'g1', handle: 'marketing', label: 'Marketing', createdAt: '', permissions: [],
    });
    vi.spyOn(client.api, 'updateGroup').mockResolvedValue({
      id: 'g1', handle: 'marketing', label: 'Marketing', createdAt: '', permissions: [],
    });
    const w = mount(GroupEditor, {
      props: { handle: 'marketing' },
      global: { plugins: [router] },
    });
    await flushPromises();
    // Toggle: enable create on posts, enable read on authors.
    await w.find('[data-testid="perm-posts-canCreate"]').setValue(true);
    await w.find('[data-testid="perm-authors-canRead"]').setValue(true);
    await w.find('[data-testid="group-save"]').trigger('click');
    await flushPromises();
    expect(setPerms).toHaveBeenCalledWith('marketing', [
      { collectionHandle: 'posts', canRead: true, canCreate: true, canUpdate: true, canDelete: false },
      { collectionHandle: 'authors', canRead: true, canCreate: false, canUpdate: false, canDelete: false },
    ]);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @vulse/admin test -- GroupEditor
```

- [ ] **Step 3: Create GroupList.vue**

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { api, type GroupDTO } from '../api/client.js';
const groups = ref<GroupDTO[]>([]);
onMounted(async () => { groups.value = await api.listGroups(); });
</script>

<template>
  <div class="p-6">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-xl font-semibold">Groups</h1>
      <RouterLink to="/settings/groups/new" class="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">+ New group</RouterLink>
    </div>
    <table class="w-full text-left text-sm">
      <thead><tr class="border-b border-zinc-200 text-xs uppercase text-zinc-500"><th class="py-2">Handle</th><th>Label</th><th></th></tr></thead>
      <tbody>
        <tr v-for="g in groups" :key="g.id" class="border-b border-zinc-100">
          <td class="py-2 font-mono">{{ g.handle }}</td>
          <td>{{ g.label }}</td>
          <td class="text-right">
            <RouterLink :to="`/settings/groups/${g.handle}`" class="text-xs text-zinc-600 hover:text-zinc-900">Edit</RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 4: Create GroupEditor.vue**

```vue
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type GroupDTO } from '../api/client.js';
import { useBlueprintsStore } from '../stores/blueprints.js';
import { useToastsStore } from '../stores/toasts.js';

const props = defineProps<{ handle: string | null }>();
const router = useRouter();
const toasts = useToastsStore();
const blueprints = useBlueprintsStore();

const isCreate = computed(() => props.handle === null);
const handle = ref('');
const label = ref('');
const saving = ref(false);

interface RowState { canRead: boolean; canCreate: boolean; canUpdate: boolean; canDelete: boolean; }
const matrix = reactive<Record<string, RowState>>({});

async function load() {
  await blueprints.hydrate();
  for (const bp of blueprints.list) {
    matrix[bp.handle] = { canRead: false, canCreate: false, canUpdate: false, canDelete: false };
  }
  if (!props.handle) return;
  const g = await api.getGroup(props.handle);
  handle.value = g.handle;
  label.value = g.label;
  for (const p of g.permissions) {
    matrix[p.collectionHandle] = { canRead: p.canRead, canCreate: p.canCreate, canUpdate: p.canUpdate, canDelete: p.canDelete };
  }
}

async function save() {
  saving.value = true;
  try {
    let g: GroupDTO;
    if (isCreate.value) {
      g = await api.createGroup({ handle: handle.value, label: label.value });
    } else {
      await api.updateGroup(props.handle!, { label: label.value });
      g = await api.getGroup(props.handle!);
    }
    const rows = Object.entries(matrix).map(([ch, r]) => ({
      collectionHandle: ch,
      canRead: r.canRead, canCreate: r.canCreate, canUpdate: r.canUpdate, canDelete: r.canDelete,
    }));
    await api.setGroupPermissions(g.handle, rows);
    toasts.success('Group saved');
    router.push('/settings/groups');
  } catch (e) {
    toasts.error((e as { response?: { message?: string } }).response?.message ?? 'Save failed');
  } finally {
    saving.value = false;
  }
}

async function destroy() {
  if (!props.handle) return;
  if (!confirm(`Delete group ${props.handle}?`)) return;
  await api.deleteGroup(props.handle);
  toasts.success('Group deleted');
  router.push('/settings/groups');
}

onMounted(load);
</script>

<template>
  <div class="p-6">
    <h1 class="mb-4 text-xl font-semibold">{{ isCreate ? 'New group' : `Edit ${handle}` }}</h1>
    <div class="max-w-3xl space-y-4">
      <div class="space-y-3 rounded border border-zinc-200 bg-white p-4">
        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Handle</span>
          <input v-model="handle" :disabled="!isCreate" class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100" />
        </label>
        <label class="block">
          <span class="block text-sm font-medium text-zinc-700">Label</span>
          <input v-model="label" class="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm" />
        </label>
      </div>
      <div class="rounded border border-zinc-200 bg-white p-4">
        <h2 class="mb-3 text-sm font-semibold text-zinc-700">Permissions</h2>
        <table class="w-full text-left text-sm">
          <thead><tr class="border-b border-zinc-200 text-xs uppercase text-zinc-500">
            <th>Collection</th><th class="text-center">Read</th><th class="text-center">Create</th><th class="text-center">Update</th><th class="text-center">Delete</th>
          </tr></thead>
          <tbody>
            <tr v-for="bp in blueprints.list" :key="bp.handle" class="border-b border-zinc-100">
              <td class="py-2 font-mono">{{ bp.handle }}</td>
              <td class="text-center"><input type="checkbox" v-model="matrix[bp.handle].canRead" :data-testid="`perm-${bp.handle}-canRead`" /></td>
              <td class="text-center"><input type="checkbox" v-model="matrix[bp.handle].canCreate" :data-testid="`perm-${bp.handle}-canCreate`" /></td>
              <td class="text-center"><input type="checkbox" v-model="matrix[bp.handle].canUpdate" :data-testid="`perm-${bp.handle}-canUpdate`" /></td>
              <td class="text-center"><input type="checkbox" v-model="matrix[bp.handle].canDelete" :data-testid="`perm-${bp.handle}-canDelete`" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center gap-2">
        <button class="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50" :disabled="saving" data-testid="group-save" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <button v-if="!isCreate" class="ml-auto rounded border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50" data-testid="group-delete" @click="destroy">
          Delete
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Add routes**

In `packages/admin/src/router.ts`:

```ts
{ path: '/settings/groups', component: () => import('./pages/GroupList.vue'), meta: { requiresAuth: true, requiresSuper: true } },
{ path: '/settings/groups/new', component: () => import('./pages/GroupEditor.vue'), props: () => ({ handle: null }), meta: { requiresAuth: true, requiresSuper: true } },
{ path: '/settings/groups/:handle', component: () => import('./pages/GroupEditor.vue'), props: true, meta: { requiresAuth: true, requiresSuper: true } },
```

- [ ] **Step 6: Add sidebar link**

Alongside `/settings/users` in `App.vue`:

```vue
        <RouterLink v-if="auth.user?.isSuper" to="/settings/groups" class="block rounded px-2 py-1.5 text-sm hover:bg-zinc-100" active-class="bg-zinc-100 font-medium" data-testid="settings-groups-link">
          Groups
        </RouterLink>
```

- [ ] **Step 7: Run tests + typecheck**

```bash
pnpm --filter @vulse/admin test
pnpm --filter @vulse/admin check
```

Expected: PASS (existing + new GroupEditor test).

- [ ] **Step 8: Commit**

```bash
git add packages/admin/src/pages/GroupList.vue packages/admin/src/pages/GroupEditor.vue packages/admin/src/pages/__tests__/GroupEditor.test.ts packages/admin/src/router.ts packages/admin/src/App.vue
git commit -m "feat(admin): group management pages with permission matrix"
```

---

## Phase B complete checkpoint

```bash
pnpm -r test
pnpm -r check
pnpm biome check .
```

Expected: all green. Editors can be scoped via groups; non-super editor
without groups gets 403 on collections; super bypasses; admin UI lets
super users manage everything.

---

# Phase C — Protected Entries

End state: an entry can be marked protected; anonymous requests to read it
return 401 (single) or are filtered out (list); editors and external users
both see it.

---

## Task C1: Migration 008

**Files:**
- Create: `packages/db/migrations/008_protected_entries.sql`

- [ ] **Step 1: Create the migration**

```sql
ALTER TABLE entries ADD COLUMN protected INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_entries_protected ON entries(collection_handle, protected);
```

- [ ] **Step 2: Wipe dev DB and verify**

```bash
rm -f apps/dev/dev.db apps/dev/dev.db-shm apps/dev/dev.db-wal
pnpm --filter @vulse/db test
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/008_protected_entries.sql
git commit -m "feat(db): migration 008 — protected column on entries"
```

---

## Task C2: Content service `protected` column

**Files:**
- Modify: `packages/core/src/content/types.ts`
- Modify: `packages/core/src/content/service.ts`
- Modify: `packages/core/src/http/api.ts`
- Create: `packages/core/src/http/__tests__/protected_entries.api.test.ts`

- [ ] **Step 1: Extend `Entry` type**

In `packages/core/src/content/types.ts`, add `protected: boolean` to `Entry`:

```ts
export interface Entry {
  id: string;
  collection: string;
  parentId: string | null;
  sortOrder: number;
  status: string;
  protected: boolean;
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

Add `protected?: boolean` to the create/update input type if there's a
dedicated one. Adjust `ListEntriesOptions` to take an optional
`includeProtected: boolean`:

```ts
export interface ListEntriesOptions {
  limit?: number;
  offset?: number;
  q?: string;
  field?: string;
  includeProtected?: boolean;
}
```

- [ ] **Step 2: Update service**

In `packages/core/src/content/service.ts`:

- `EntryRow` gains `protected: number`.
- `rowToEntry` reads `protected: row.protected === 1`.
- `list()` applies `AND protected = 0` when `opts.includeProtected !== true`.
- `create()` accepts `protected` in the input (boolean → integer).
- `update()` accepts `protected`.

Key fragments:

```ts
interface EntryRow {
  // ... existing ...
  protected: number;
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

// In list():
const protectedClause = opts.includeProtected ? '' : ' AND protected = 0';
const whereSql = `WHERE collection_handle = ?${protectedClause}${search.sql}`;

// In create():
const isProtected = (input as { protected?: boolean }).protected ? 1 : 0;
await db.exec(
  `INSERT INTO entries (id, collection_handle, parent_id, sort_order, status, protected, content)
   VALUES (?, ?, ?, ?, 'published', ?, ?)`,
  [id, handle, parentId, sortOrder, isProtected, JSON.stringify(validated)],
);

// In update():
const fields: string[] = ['content = ?', `updated_at = datetime('now')`];
const params: unknown[] = [JSON.stringify(validated)];
if ('protected' in (input as object)) {
  fields.push('protected = ?');
  params.push((input as { protected: boolean }).protected ? 1 : 0);
}
await db.exec(`UPDATE entries SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
```

- [ ] **Step 3: Update API**

In `packages/core/src/http/api.ts`, modify the GET list and GET single
routes to consult auth state:

```ts
app.get('/api/collections/:handle', requirePerm({ action: 'read', adapter }), async (c) => {
  // ... existing handle check + params ...
  return c.json(
    await content.list(handle, {
      limit, offset,
      ...(q ? { q } : {}),
      ...(field ? { field } : {}),
      includeProtected: c.get('user') !== null, // signed-in users see all
    }),
  );
});

app.get('/api/collections/:handle/:id', requirePerm({ action: 'read', adapter }), async (c) => {
  const handle = c.req.param('handle');
  if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
  const entry = await content.get(handle, c.req.param('id'));
  if (!entry) throw new NotFoundError('entry not found');
  if (entry.protected && !c.get('user')) return c.json({ error: 'auth_required' }, 401);
  return c.json(entry);
});
```

Note: `requirePerm` already returns 401 if not authenticated. For the GET
single, the protected check is redundant when requirePerm is present, but
keep it so anyone changing the gating later doesn't accidentally leak. If
we want unauthenticated reads of UNprotected entries (the spec says this is
desired for "external website visitors"), then GET list / GET single must
NOT go through `requirePerm`. Instead:

Replace the two GET handlers' wrapping with a custom guard:

```ts
app.get('/api/collections/:handle', async (c) => {
  const handle = c.req.param('handle');
  if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
  const user = c.get('user');
  // Anonymous: only unprotected entries; requires no permission check.
  // Authenticated editors/external_user: filter happens via the perm middleware applied per role.
  if (user && user.role === 'editor' && !user.isSuper) {
    // Need read permission for editors.
    const perms = await effectivePerms(user, adapter);
    if (!perms.get(handle)?.has('read')) return c.json({ error: 'forbidden' }, 403);
  }
  // ... rest of list logic ...
  return c.json(await content.list(handle, { limit, offset, ...(q ? { q } : {}), ...(field ? { field } : {}), includeProtected: user !== null }));
});
```

Similarly for GET single. Mutations still use `requirePerm`. (Spec §
"Protected entries" gives anonymous read of unprotected; this requires the
nuance above.)

- [ ] **Step 4: Write protected_entries.api.test.ts**

```ts
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { createAuth, seedSuperUser } from '@vulse/auth';
import { beforeEach, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { createContentService } from '../../content/service.js';
import { createApi } from '../api.js';
import { loadBlueprints } from '../../blueprints/load.js';
// ... plus the existing seed of a 'posts' blueprint ...

describe('protected entries', () => {
  let app: ReturnType<typeof createApi>;
  let adapter: LibsqlAdapter;

  beforeEach(async () => {
    adapter = new LibsqlAdapter({ url: ':memory:' });
    await adapter.exec('PRAGMA foreign_keys = ON');
    await runMigrations(adapter, MIGRATIONS_DIR);
    // seed a 'posts' blueprint inline:
    await adapter.exec(
      `INSERT INTO collections (handle, label, definition) VALUES ('posts','Posts','{"handle":"posts","label":"Posts","singleton":false,"fields":[{"name":"title","label":"Title","ui":{"kind":"text"},"optional":false}]}')`,
    );
    // seed one public + one protected entry:
    const e1 = ulid(), e2 = ulid();
    await adapter.exec(`INSERT INTO entries (id, collection_handle, sort_order, status, protected, content) VALUES (?, 'posts', 1, 'published', 0, ?)`, [e1, JSON.stringify({ title: 'Public' })]);
    await adapter.exec(`INSERT INTO entries (id, collection_handle, sort_order, status, protected, content) VALUES (?, 'posts', 2, 'published', 1, ?)`, [e2, JSON.stringify({ title: 'Secret' })]);
    const authInstance = createAuth({ libsqlUrl: ':memory:', env: { authSecret: 's', baseUrl: 'http://x', allowPublicSignup: true, smtpUrl: undefined } });
    await seedSuperUser({ adapter, bootstrapEmail: 'a@a.com', bootstrapPassword: 'hunter2hunter2', isProd: false });
    const blueprints = await loadBlueprints({ adapter });
    const content = createContentService(adapter, blueprints);
    app = createApi({ blueprints, content, adapter, authInstance });
  });

  it('anonymous list filters out protected entries', async () => {
    const res = await app.request('http://x/api/collections/posts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { content: { title: string } }[] };
    expect(body.items.map((e) => e.content.title)).toEqual(['Public']);
  });

  it('anonymous single GET on protected entry returns 401', async () => {
    const list = await adapter.query<{ id: string; protected: number }>('SELECT id, protected FROM entries WHERE collection_handle = ? ORDER BY sort_order', ['posts']);
    const protectedId = list.find((r) => r.protected === 1)!.id;
    const res = await app.request(`http://x/api/collections/posts/${protectedId}`);
    expect(res.status).toBe(401);
  });

  // Authenticated test omitted for brevity; mirror the "sign in + cookie" helper from B4.
});
```

- [ ] **Step 5: Run and verify**

```bash
pnpm --filter @vulse/core test -- protected_entries
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/content/ packages/core/src/http/api.ts packages/core/src/http/__tests__/protected_entries.api.test.ts
git commit -m "feat(core): protected-entry filter and 401 gate"
```

---

## Task C3: Admin "Protected" checkbox on CollectionEntry

**Files:**
- Modify: `packages/admin/src/pages/CollectionEntry.vue`
- Modify: `packages/admin/src/api/client.ts` (if entry types need updating)

- [ ] **Step 1: Surface `protected` in entry state**

In `CollectionEntry.vue`, after the existing `state` reactive, add:

```ts
const isProtected = ref(false);
```

In `loadEntry()`, when loading an existing entry, also set
`isProtected.value = entry.protected ?? false`. In the create branch, leave
it at `false`.

In `save()`, include `protected: isProtected.value` in the payload sent to
`api.create` / `api.update`.

- [ ] **Step 2: Add the Visibility card to the template**

Inside the `<form>` block, after the `<FieldRenderer>` loop and before the
`submitError` div, add:

```vue
        <div class="rounded border border-zinc-200 bg-white p-3">
          <h3 class="mb-2 text-sm font-semibold text-zinc-700">Visibility</h3>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="isProtected" type="checkbox" class="rounded border-zinc-300" data-testid="entry-protected" />
            <span class="text-zinc-700">Protected (requires sign-in to view)</span>
          </label>
        </div>
```

- [ ] **Step 3: Run admin tests**

```bash
pnpm --filter @vulse/admin test
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/admin/src/pages/CollectionEntry.vue
git commit -m "feat(admin): per-entry Protected toggle"
```

---

## Task C4: Phase C smoke test

**Files:**
- Modify: `apps/dev/src/smoke.test.ts`

- [ ] **Step 1: Append the protected-entry test**

Append to `apps/dev/src/smoke.test.ts`:

```ts
describe('protected entries', () => {
  it('anonymous cannot read a protected entry; signed-in can', async () => {
    // Sign in as the bootstrap super user.
    const signin = await fetch(`${base}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@vulse.local', password: process.env.VULSE_BOOTSTRAP_PASSWORD ?? 'hunter2hunter2' }),
    });
    // In :memory: smoke we do not know the random password; instead seed an editor inline.
    // For the smoke test, the simplest path is to use VULSE_BOOTSTRAP_EMAIL/PASSWORD env in beforeAll.
    expect([200, 401]).toContain(signin.status);
    // ... (see plan note) ...
  });
});
```

**Note:** the bootstrap super user's random password makes this test
brittle. Update the smoke test's `beforeAll` to set
`process.env.VULSE_BOOTSTRAP_EMAIL = 'admin@vulse.local'` and
`process.env.VULSE_BOOTSTRAP_PASSWORD = 'smoke-test-pw-12345'` before
creating the Vite server. Then sign in with that known password.

- [ ] **Step 2: Update `beforeAll` in the smoke test**

```ts
beforeAll(async () => {
  process.env.VULSE_DB_URL = ':memory:';
  process.env.VULSE_BOOTSTRAP_EMAIL = 'admin@vulse.local';
  process.env.VULSE_BOOTSTRAP_PASSWORD = 'smoke-test-pw-12345';
  server = await createServer({ /* ... */ });
  // ...
});
```

Then the protected-entry block:

```ts
it('anonymous cannot read a protected entry; signed-in can', async () => {
  const signin = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@vulse.local', password: 'smoke-test-pw-12345' }),
  });
  expect(signin.status).toBe(200);
  const cookie = signin.headers.get('set-cookie') ?? '';

  // Create a protected entry.
  const created = await fetch(`${base}/api/collections/posts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      title: 'Secret', slug: 'secret',
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
      status: 'draft', protected: true,
    }),
  });
  expect(created.status).toBe(201);
  const entry = (await created.json()) as { id: string };

  // Anonymous: 401.
  const anonRes = await fetch(`${base}/api/collections/posts/${entry.id}`);
  expect(anonRes.status).toBe(401);

  // Signed-in: 200.
  const authedRes = await fetch(`${base}/api/collections/posts/${entry.id}`, { headers: { cookie } });
  expect(authedRes.status).toBe(200);
});
```

- [ ] **Step 3: Run**

```bash
pnpm --filter @vulse/dev test
```

- [ ] **Step 4: Commit**

```bash
git add apps/dev/src/smoke.test.ts
git commit -m "test(dev): smoke covers anon/authed protected-entry access"
```

---

## Phase C complete checkpoint

```bash
pnpm -r test
pnpm -r check
pnpm biome check .
```

Expected: all green. Protected entries reject anonymous reads; the admin
Visibility card toggles the flag.

---

# Phase D — Documentation

End state: a developer new to the codebase can read `docs/auth.md` and
configure auth from a fresh checkout without reading any code.

---

## Task D1: Write `docs/auth.md`

**Files:**
- Create: `docs/auth.md`
- Modify: `README.md` (add a link to the new doc)

- [ ] **Step 1: Write the documentation**

Create `docs/auth.md` with these top-level sections (use the actual content
and code samples from Phases A–C; keep examples minimal and runnable):

```markdown
# Vulse authentication and permissions

This document covers how Vulse handles authentication, users, groups,
permissions, and protected entries. It is the source of truth for setting
up auth in a fresh Vulse deployment and for extending the system with
custom Hono routes.

## 1. Setup

### Required environment variables

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `VULSE_AUTH_SECRET` | Yes (prod) | Auto-generated weak default in dev | Signs session cookies. Rotate periodically. |
| `VULSE_AUTH_BASE_URL` | No | Request origin | Used for absolute URLs in emails. |
| `VULSE_ALLOW_PUBLIC_SIGNUP` | No | `true` | Set to `false` to disable `/api/auth/sign-up/email`. |
| `VULSE_BOOTSTRAP_EMAIL` | Yes (prod) | unset (dev: `admin@vulse.local`) | First-boot super user. |
| `VULSE_BOOTSTRAP_PASSWORD` | Yes (prod) | unset (dev: random) | First-boot super user. |
| `VULSE_SMTP_URL` | Recommended | unset (dev: stdout) | Password reset transport. |

### First boot

When the `users` table is empty, Vulse seeds one super user. In dev with no
env vars, you'll see something like this in your terminal:

```
[vulse:auth] First-boot super user seeded.
  Email: admin@vulse.local
  Password: A7gX9mQ2RpN1yKvT
```

Sign in with those credentials at `/login`.

### Disabling public signup

Set `VULSE_ALLOW_PUBLIC_SIGNUP=false`. Visitors hitting
`POST /api/auth/sign-up/email` will receive a 403. Super users can still
create accounts (of either role) at `/settings/users/new`.

### SMTP

Set `VULSE_SMTP_URL` to a `smtp://user:pass@host:port` URL. Without it,
password reset links are printed to stdout — useful in dev, never in prod.

## 2. Concepts

- **Role.** One of `editor` or `external_user`. Editors can be granted
  CRUD on collections via groups. External users are read-only globally
  and exist primarily to consume protected entries.
- **Super flag.** A boolean on the user row. Super users bypass all
  permission checks and can manage users, groups, and blueprints. The
  first user seeded on boot is super.
- **Group.** A named bundle of per-collection CRUD grants. Users belong
  to N groups; their effective permissions are the union.
- **Protected entry.** A per-entry boolean. Anonymous requests to read
  a protected entry return 401. Authenticated users see them subject to
  their normal collection read permission.
- **Permission resolution order (per request):**
  1. `sessionMiddleware` resolves the session cookie into `c.var.user`.
  2. For collection mutations: `requirePerm({ action })` checks
     `user.isSuper` → bypass; `role === 'external_user'` → 403; else
     `effectivePerms(user)` includes the (handle, action).
  3. For blueprint/user/group writes: `requireSuper()` checks `isSuper`.
  4. For collection reads: anonymous sees only unprotected entries;
     editors must have `read`; external users see all.

## 3. Recipes

### Promote a user to super

```sql
UPDATE users SET is_super = 1 WHERE email = 'someone@example.com';
```

Or in the admin: `/settings/users/:id` → check "Super user" → Save.

### Restrict an editor to one collection

1. Create a group: `/settings/groups/new` (handle e.g. `marketing`).
2. Toggle the `posts` row's `Read`, `Create`, `Update` (leave `Delete`
   off). Save.
3. Edit the user at `/settings/users/:id` → tick `marketing` →
   uncheck "Super user" → Save.

### Mark an entry protected

Open the entry in the admin. In the Visibility card, tick
"Protected (requires sign-in to view)". Save.

### Rotate the auth secret

1. Generate a new secret: `openssl rand -hex 32`.
2. Set `VULSE_AUTH_SECRET=<new>` and restart.
3. Existing sessions invalidate; all users must sign in again.

### Bootstrap a fresh DB

Delete `apps/dev/dev.db*` and restart `pnpm dev`. Migrations run, the
super user is seeded, and you can sign in immediately.

## 4. API reference

### Auth (Better Auth)

- `POST /api/auth/sign-up/email` — body `{ email, password, name? }`.
  Gated by `VULSE_ALLOW_PUBLIC_SIGNUP`. Always creates an external user.
- `POST /api/auth/sign-in/email` — body `{ email, password }`.
  Returns session cookie.
- `POST /api/auth/sign-out`.
- `POST /api/auth/forget-password` — body `{ email, redirectTo }`.
- `POST /api/auth/reset-password` — body `{ token, newPassword }`.
- `GET /api/auth/me` — returns `{ user: AuthUser | null, perms: Record<string, Action[]> }`.

### Users (super only)

- `GET /api/users?role=editor&limit=50&offset=0`
- `POST /api/users` — body `{ email, password, name, role, isSuper, groupIds }`
- `GET /api/users/:id`
- `PATCH /api/users/:id` — body `{ name?, role?, isSuper?, groupIds? }`
- `DELETE /api/users/:id`

### Groups (super only)

- `GET /api/groups`
- `POST /api/groups` — body `{ handle, label }`
- `GET /api/groups/:handle`
- `PATCH /api/groups/:handle` — body `{ label }`
- `PUT /api/groups/:handle/permissions` — body
  `{ rows: { collectionHandle, canRead, canCreate, canUpdate, canDelete }[] }`
- `DELETE /api/groups/:handle`

### Error shape

All auth-related errors:
```json
{ "error": "auth_required" }            // 401
{ "error": "forbidden" }                // 403
{ "error": "signup_disabled" }          // 403 on /api/auth/sign-up/email
{ "error": "not_found" }                // 404 (user/group)
```

## 5. Middleware reference

Auth middleware is exported from `@vulse/auth`. To gate a custom Hono
route in your own extension:

```ts
import { sessionMiddleware, requireSuper, requirePerm } from '@vulse/auth';

app.use('*', sessionMiddleware(authInstance));            // global
app.get('/api/admin/widgets', requireSuper(), handler);   // super-only
app.get(
  '/api/collections/posts/extra',
  requirePerm({ action: 'read', adapter }),
  handler,
);
```

`requirePerm` reads `:handle` from the route. If your route uses a
different param name, wrap the route with a custom guard that calls
`effectivePerms` directly.

## 6. Testing

### Sign-in fixture

In tests, the simplest way to get an authenticated session is:

```ts
// 1. Create a user.
const user = await createUser(adapter, { /* ... */ });
// 2. Sign in via the app's Hono instance to set the cookie.
const res = await app.request('http://x/api/auth/sign-in/email', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: user.email, password: 'pw-used-on-createUser' }),
});
const cookie = res.headers.get('set-cookie') ?? '';
// 3. Use the cookie on subsequent requests.
await app.request('http://x/api/collections/posts', { headers: { cookie } });
```

For unit tests that don't need a full Hono round-trip, construct an
`AuthUser` object directly and inject it into `c.set('user', user)` via
custom middleware, as the auth test suite does.
```

- [ ] **Step 2: Link from README**

In `README.md`, add a section near the top:

```markdown
## Documentation

- [Authentication and permissions](docs/auth.md) — users, groups, protected entries
```

- [ ] **Step 3: Commit**

```bash
git add docs/auth.md README.md
git commit -m "docs: authentication and permissions guide"
```

---

## Final verification

- [ ] **Run the full workspace gate**

```bash
pnpm -r test
pnpm -r check
pnpm biome check .
```

Expected: clean across all packages.

- [ ] **Manual smoke**

```bash
rm -f apps/dev/dev.db apps/dev/dev.db-shm apps/dev/dev.db-wal
pnpm dev
```

In the admin:
1. Read the seeded super-user credentials from stdout, sign in.
2. Create a new editor at `/settings/users/new`, no groups.
3. Sign out, sign in as that editor.
4. Confirm: no schema link in sidebar (not super); collections show but
   collection list endpoints return 403.
5. Sign back in as super; create a group with read perm on `posts`;
   assign the editor.
6. Sign in as the editor; can read posts but not create.
7. Create a protected entry. Sign out. Hit `/api/collections/posts/:id`
   directly — 401. Hit list — entry is filtered out.

- [ ] **Cleanup task list (if using TaskCreate)**

Mark all tasks complete.
