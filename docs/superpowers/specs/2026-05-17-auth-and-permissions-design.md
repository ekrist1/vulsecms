# Auth, users, groups, and protected entries — Design

Date: 2026-05-17
Status: Approved

## Problem

Vulse has no authentication or authorization. Every API endpoint is open;
the admin SPA loads without a login; entries are universally readable. We
need:

1. A login/logout system so the admin is not anonymously accessible.
2. Two roles — editors (CMS-side) and external users (read-only).
3. Per-collection editor permissions managed via groups.
4. A "protected" flag on individual entries that gates them behind any
   authenticated user.
5. Developer documentation explaining the moving parts.

The library is **Better Auth**. The CMS is in active development, so
forward-only migrations and dev DB resets are acceptable.

## Goals

- Ship email/password login (+ password reset) with cookie sessions.
- Add a super-user bypass so the first editor can bootstrap the system.
- Make `editor` permissions enforced per-collection × per-CRUD-action via
  group memberships.
- Add a per-entry `protected` boolean that returns 401 to anonymous
  requests.
- Document setup, concepts, recipes, API, and middleware.

## Non-goals (v1)

- OAuth providers (Google/GitHub) — defer to v2.
- Email verification on signup — schema has the column for future use, no
  enforcement.
- Per-entry group allow-lists (Statamic's `allowed_groups`) — boolean
  protected only.
- Per-collection default-protected setting in blueprints.
- Per-status permission (e.g. "can publish but not delete") — CRUD only.
- Audit `created_by` / `updated_by` columns on entries.
- Admin-side password change UI (handled via password reset link in v1).

## Architecture

A new workspace package, `@vulse/auth`, owns auth concerns. It depends on
`@vulse/db` for migrations and exports a small, well-typed surface:

```
@vulse/auth
├── src/index.ts                  // re-exports
├── src/instance.ts               // createAuth({ adapter, config }) → BetterAuth + Hono router
├── src/middleware/session.ts     // sessionMiddleware
├── src/middleware/requirePerm.ts // requirePerm({ action })
├── src/middleware/requireSuper.ts
├── src/permissions.ts            // effectivePerms(user, adapter)
├── src/bootstrap.ts              // seedSuperUser on first boot
├── src/users.ts                  // CRUD service for users (used by /api/users)
├── src/groups.ts                 // CRUD service for groups + permission matrix
├── src/types.ts                  // Role, Action, GroupPermission, Session, AuthUser
└── src/__tests__/...
```

`@vulse/core/http/api.ts` mounts:

- Better Auth's Hono router at `/api/auth/*` (login, signup, logout, reset).
- `sessionMiddleware` globally — populates `c.var.session`, `c.var.user`.
- `requirePerm({ action })` wraps each `/api/collections/:handle` route.
- `requireSuper` wraps `/api/blueprints/*` writes, `/api/users/*`,
  `/api/groups/*`.

`@vulse/admin` gains a login page, a route guard, an auth Pinia store, and
admin pages for users and groups. Existing pages hide/disable controls
based on effective permissions; the API remains the source of truth.

## Data model

Two new migrations.

### `007_auth.sql`

```sql
-- Better Auth core tables. We commit the SQL emitted by Better Auth's
-- CLI and add Vulse-specific columns (`role`, `is_super`) to `users`.

CREATE TABLE users (
  id              TEXT PRIMARY KEY,                -- ULID
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
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id            TEXT NOT NULL,
  provider_id           TEXT NOT NULL,                   -- 'credential' for email/password
  password              TEXT,                            -- hashed
  access_token          TEXT,
  refresh_token         TEXT,
  id_token              TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
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
  handle      TEXT NOT NULL UNIQUE,           -- e.g. 'marketing'
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

### `008_protected_entries.sql`

```sql
ALTER TABLE entries ADD COLUMN protected INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_entries_protected ON entries(collection_handle, protected);
```

## Auth flow

Better Auth is configured with the libSQL adapter via Drizzle (Better Auth
has first-class support; the adapter wraps `@libsql/client`). Provider: email
+ password. Cookie session, HTTP-only, `SameSite=Lax`, `Secure` in production.
Password hashing via the default scrypt parameters.

### Endpoints (mounted by Better Auth)

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/auth/sign-up/email` | Gated by `VULSE_ALLOW_PUBLIC_SIGNUP`. When `false`, returns 403. Always creates `role='external_user'`, `is_super=0`. |
| POST | `/api/auth/sign-in/email` | Returns session cookie + user. |
| POST | `/api/auth/sign-out` | Clears session. |
| POST | `/api/auth/forget-password` | Sends reset email via configured SMTP. |
| POST | `/api/auth/reset-password` | Consumes token, sets new password. |
| GET  | `/api/auth/get-session` | Returns current session+user (or 401). |

### Bootstrap

`@vulse/auth/bootstrap.ts` exports `seedSuperUser({ adapter })`. Called from
the dev Vite plugin and from `apps/dev/src/server.prod.ts` after migrations
and before `loadBlueprints`. If `users` table is empty:

- If `VULSE_BOOTSTRAP_EMAIL` and `VULSE_BOOTSTRAP_PASSWORD` are set, create
  that user with `role='editor'`, `is_super=1`.
- Otherwise (dev fallback, `NODE_ENV !== 'production'`): create
  `admin@vulse.local` with a random 16-char password, write it to stdout
  exactly once. When `NODE_ENV === 'production'`, refuse to start without
  explicit env vars (exit non-zero with a clear message).

### Public-signup kill switch

`VULSE_ALLOW_PUBLIC_SIGNUP` (`'true'` | `'false'`, default `'true'`). The
gate is enforced as a Better Auth pre-handler hook on the sign-up route.
When disabled, the endpoint returns 403 with `{error: 'signup_disabled'}`.

## Permission model

```
                              ┌───────────────────────────┐
  Request → sessionMiddleware │ c.var.user (User | null)  │
                              │ c.var.session             │
                              └───────────────┬───────────┘
                                              │
   ┌──────────────────────────────────────────┴──────────────────────┐
   │                                                                 │
   ▼                                                                 ▼
/api/auth/* (no gate)                       /api/blueprints/*  (requireSuper)
                                            /api/users/*       (requireSuper)
                                            /api/groups/*      (requireSuper)
                                                                     │
                              /api/collections/:handle               │
                              (requirePerm({ action }))              │
                                            │                        │
                                            ▼                        │
                              ┌────────────────────────────────┐     │
                              │ if !user → 401                 │     │
                              │ if user.is_super → allow       │     │
                              │ if user.role==='external_user' │     │
                              │    && action !== 'read' → 403  │     │
                              │ effectivePerms(user) has       │     │
                              │   (handle, action)? → allow    │     │
                              │ else → 403                     │     │
                              └────────────────────────────────┘     │
                                                                     ▼
                                                              Better Auth router
```

### `effectivePerms(user)`

```ts
type Action = 'read' | 'create' | 'update' | 'delete';
type EffectivePerms = Map<string, Set<Action>>; // collection_handle → actions

async function effectivePerms(user: AuthUser, adapter: DatabaseAdapter)
  : Promise<EffectivePerms> {
  if (user.role === 'external_user') {
    // Reads-only of *protected* entries are governed by entry-level
    // middleware, not this map. Editors with no groups get an empty map.
    return new Map();
  }
  if (user.is_super) {
    // Sentinel: a single entry with handle '*' meaning "all collections,
    // all actions". The middleware short-circuits on this.
    return new Map([['*', new Set(['read','create','update','delete'])]]);
  }
  const rows = await adapter.query<{
    collection_handle: string,
    can_read: number, can_create: number,
    can_update: number, can_delete: number,
  }>(`
    SELECT gp.collection_handle, gp.can_read, gp.can_create,
           gp.can_update, gp.can_delete
    FROM user_groups ug
    JOIN group_permissions gp ON gp.group_id = ug.group_id
    WHERE ug.user_id = ?
  `, [user.id]);
  const map: EffectivePerms = new Map();
  for (const r of rows) {
    const set = map.get(r.collection_handle) ?? new Set<Action>();
    if (r.can_read)   set.add('read');
    if (r.can_create) set.add('create');
    if (r.can_update) set.add('update');
    if (r.can_delete) set.add('delete');
    map.set(r.collection_handle, set);
  }
  return map;
}
```

Result is cached per-request via `c.set('perms', map)` to avoid repeated
lookups when a single handler does multiple checks.

### External user shortcut

External users have **read-only** access globally. Any non-`read` action
short-circuits to 403 before the perms lookup. Their reads are allowed for
unprotected entries unconditionally, and for protected entries because they
are authenticated (see next section).

## Protected entries

`entries.protected` is a boolean column (default 0). Enforcement happens in
two places inside the existing `@vulse/core/content` service, NOT as a
separate middleware (so the same logic runs whether content is fetched via
the REST API or the in-process service).

1. **List `GET /api/collections/:handle`**
   - Anonymous: SQL filter `WHERE protected = 0`.
   - Authenticated: no filter.
2. **Single `GET /api/collections/:handle/:id`**
   - If `protected = 1` and no session → 401 with `{error: 'auth_required'}`.
   - Otherwise: standard permission check.

Editors with `read` permission see protected entries as a matter of course.
External users see all entries (protected and not) — that's the point of
the external-user role.

The blueprint editor does NOT need to know about protected; the per-entry
toggle is in the CollectionEntry page only. The wire shape gains
`protected: boolean` alongside `id`, `content`, `status`, etc.

## Admin UI

### New routes

| Route | Page | Auth |
|---|---|---|
| `/login` | `LoginPage.vue` | unauthenticated |
| `/forgot-password` | `ForgotPasswordPage.vue` | unauthenticated |
| `/reset-password/:token` | `ResetPasswordPage.vue` | unauthenticated |
| `/settings/users` | `UserList.vue` | super |
| `/settings/users/new` | `UserEditor.vue` (create) | super |
| `/settings/users/:id` | `UserEditor.vue` (edit) | super |
| `/settings/groups` | `GroupList.vue` | super |
| `/settings/groups/new` | `GroupEditor.vue` (create) | super |
| `/settings/groups/:handle` | `GroupEditor.vue` (edit) | super |

### Auth store

```ts
// packages/admin/src/stores/auth.ts
type AuthState = {
  user: AuthUser | null;
  perms: Record<string, ('read'|'create'|'update'|'delete')[]>;
  hydrated: boolean;
};
actions: { hydrate(), login(email, pw), logout(), refresh() }
```

`hydrate()` calls `GET /api/auth/get-session` on app boot. The global route
guard in `App.vue` uses the store: routes flagged `meta.requiresAuth` (every
non-login route by default) redirect to `/login` when `user` is null.
Routes flagged `meta.requiresSuper` additionally check `user.is_super`.

### Existing pages

- Sidebar topbar gains a current-user chip (email + dropdown with "Sign out").
- Settings sidebar group gains "Users" and "Groups" links (alongside Schema).
- `CollectionEntry.vue` gets a "Protected" checkbox in a small Visibility
  card. The card sits below the field list, alongside the existing slug/title
  inputs.
- `BlueprintList.vue`, `CollectionList.vue`, `CollectionEntry.vue` hide or
  disable controls (e.g. "Delete", "+ New") based on
  `auth.perms[collectionHandle]?.includes(action)`. The API enforces; the UI
  is a UX nicety.

### Group editor — permission matrix

`GroupEditor.vue` renders a table: rows = collection handles (from blueprint
store), columns = `read | create | update | delete`. Each cell is a
checkbox. Saving sends a `PUT /api/groups/:handle/permissions` payload
`{ collection_handle, can_read, can_create, can_update, can_delete }[]`.

## API additions

Under `requireSuper`:

| Method | Path | Behavior |
|---|---|---|
| GET    | `/api/users` | list users (paginated by `limit`/`offset`, filter by `role`) |
| POST   | `/api/users` | create user (role + is_super + password hash); 400 if email taken |
| GET    | `/api/users/:id` | fetch user + group memberships |
| PATCH  | `/api/users/:id` | update name, role, is_super, group memberships |
| DELETE | `/api/users/:id` | delete user (cascades sessions) |
| GET    | `/api/groups` | list groups |
| POST   | `/api/groups` | create group |
| GET    | `/api/groups/:handle` | fetch group + permission rows |
| PATCH  | `/api/groups/:handle` | update label |
| PUT    | `/api/groups/:handle/permissions` | replace permission rows |
| DELETE | `/api/groups/:handle` | delete group (cascades user_groups + permissions) |

Plus one auth-flow endpoint (registered alongside Better Auth's routes; no
permission gate of its own — returns `{ user: null, perms: {} }` when not
signed in instead of 401, so the admin can boot without flickering):

| Method | Path | Behavior |
|---|---|---|
| GET    | `/api/auth/me` | Vulse-specific. Wraps Better Auth's `getSession` and bundles the effective permission map, so the admin only makes one request on hydrate. |

## Configuration & secrets

| Env var | Default | Notes |
|---|---|---|
| `VULSE_AUTH_SECRET` | required in prod, generated in dev | signs session cookies |
| `VULSE_ALLOW_PUBLIC_SIGNUP` | `true` | kill switch for `/api/auth/sign-up/email` |
| `VULSE_BOOTSTRAP_EMAIL` | unset | seeds first super user |
| `VULSE_BOOTSTRAP_PASSWORD` | unset | seeds first super user |
| `VULSE_SMTP_URL` | unset (dev: log-to-stdout) | password-reset email transport |
| `VULSE_AUTH_BASE_URL` | request origin | for absolute URLs in emails |

In dev, if `VULSE_SMTP_URL` is unset, password-reset emails are written to
stdout (the link is printed). README documents this fallback.

## Testing

**`@vulse/auth` unit tests:**
- `sessionMiddleware` — sets `user=null` on missing/invalid cookie, populates
  on valid session.
- `requireSuper` — 401 anon, 403 non-super, 200 super.
- `requirePerm` — matrix: anon/external/editor-no-groups/editor-with-group ×
  read/create/update/delete × allowed/denied.
- `effectivePerms` — group union, super sentinel, external_user empty map.
- `bootstrap.seedSuperUser` — runs once, idempotent on second call.

**`@vulse/core` integration tests:**
- `http/api.test.ts` extended with auth fixtures (sign-in helper) and
  permission-matrix cases on each collection route.
- `http/protected_entries.api.test.ts` — anonymous list filters protected
  rows; anonymous single returns 401; authenticated single returns 200.

**Admin tests:**
- `LoginPage` — happy path + invalid creds + redirect on success.
- Route guard — redirect to `/login` when unauthenticated; respects
  `redirect_to` query.
- `GroupEditor` — permission matrix saves correct payload shape.
- `UserList` — filters by role, deletes user.

**Smoke test (`apps/dev/src/smoke.test.ts`):**
- After existing tests: sign up an external user, sign in, fetch a
  protected entry → 200; sign out, fetch same entry → 401; super user
  fetches → 200.

## Developer documentation

A new file `docs/auth.md`, indexed from the root `README.md`.

1. **Setup** — env vars, first-boot bootstrap, SMTP config, switching off
   public signup.
2. **Concepts** — roles, super flag, groups, permission resolution,
   protected entries.
3. **Recipes:**
   - Promote a user to super
   - Restrict an editor to a single collection
   - Mark an entry protected
   - Rotate `VULSE_AUTH_SECRET`
   - Bootstrap a fresh DB
4. **API reference** — every new endpoint, request/response shapes,
   error codes.
5. **Middleware reference** — `sessionMiddleware`, `requirePerm`,
   `requireSuper` usage for custom Hono routes.
6. **Testing patterns** — sign-in helper, fixture factories.

## Implementation phasing (informational; the plan will execute this order)

- **Phase A — Auth foundation.** `@vulse/auth` package, Better Auth wiring,
  migration 007 minus group tables, login/logout/signup/password reset,
  `sessionMiddleware`, super bootstrap, admin login page + route guard.
  End state: editor logs in, gets `user.is_super=1`, route guard works,
  no group enforcement yet.
- **Phase B — Groups + permissions.** Group tables, `effectivePerms`,
  `requirePerm`, `requireSuper`, admin users + groups + permission-matrix
  pages.
- **Phase C — Protected entries.** Migration 008, content service column,
  middleware/SQL filter, admin Visibility card.
- **Phase D — Docs.** `docs/auth.md` covering setup, concepts, recipes,
  API, middleware, testing.

Each phase ends with a green workspace (`pnpm -r test`, `pnpm -r typecheck`,
`pnpm biome check .`) and a working `pnpm dev` demo.

## Open questions / risks

1. **Better Auth + libSQL adapter.** Better Auth's Drizzle adapter works
   with libSQL via `@libsql/client`. If the adapter's column-naming
   conventions clash with our snake_case migrations, we map names in the
   Better Auth config rather than rewriting the migrations.
2. **Permission UI for collections that don't exist yet.** When a new
   collection is created, `group_permissions` rows for it don't exist. The
   GroupEditor renders the matrix from the blueprint store, so it always
   shows current collections. New collections default to "no permissions"
   until an admin grants them.
3. **External users on the admin app.** External users shouldn't be able to
   log into the admin SPA at all. The login page checks
   `user.role === 'editor'` after sign-in; if `external_user`, it signs them
   back out and shows a "this account cannot access the admin" message.
4. **Cookie domain in dev.** The admin SPA and Vulse API run on the same
   origin during dev (Vite plugin proxies `/api/*`). Cookie domain default
   works. Document if a user later splits the admin to a different origin.
5. **Password reset email rendering.** v1 ships a minimal HTML template
   embedded in `@vulse/auth/email.ts`. No templating engine. Custom
   branding is a v2 concern.
