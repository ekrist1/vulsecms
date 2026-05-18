# Vulse authentication and permissions

How Vulse handles authentication, users, groups, permissions, and protected
entries. The source of truth for setting up auth in a fresh Vulse deployment
and for extending the system with custom Hono routes.

## 1. Setup

### Environment variables

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `VULSE_AUTH_SECRET` | Yes (prod) | weak default in dev | Signs session cookies. Rotate periodically. |
| `VULSE_AUTH_BASE_URL` | No | request origin | Used for absolute URLs in emails. |
| `VULSE_ALLOW_PUBLIC_SIGNUP` | No | `true` | Set to `false` to disable `/api/auth/sign-up/email`. |
| `VULSE_BOOTSTRAP_EMAIL` | Yes (prod) | unset (dev: `admin@vulse.local`) | First-boot super user. |
| `VULSE_BOOTSTRAP_PASSWORD` | Yes (prod) | unset (dev: random) | First-boot super user. |
| `VULSE_SMTP_URL` | Recommended | unset (dev: stdout) | Password reset transport, e.g. `smtp://user:pass@host:port`. |

### First boot

When the `users` table is empty, Vulse seeds one super user. In dev with no
env vars set, the password is printed to stdout:

```
[vulse:auth] First-boot super user seeded.
  Email: admin@vulse.local
  Password: A7gX9mQ2RpN1yKvT
```
            


Sign in with those credentials at `/login`. In production, Vulse refuses
to start without both `VULSE_BOOTSTRAP_EMAIL` and `VULSE_BOOTSTRAP_PASSWORD`.

### Disabling public signup

Set `VULSE_ALLOW_PUBLIC_SIGNUP=false`. Visitors hitting
`POST /api/auth/sign-up/email` will receive a 403. Super users can still
create accounts of either role at `/settings/users/new`.

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
- **Protected entry.** A per-entry boolean. Anonymous requests to read a
  protected entry return 401. Authenticated users see them subject to
  their normal collection read permission.
- **Permission resolution order (per request):**
  1. `sessionMiddleware` resolves the session cookie into `c.var.user`.
  2. For collection mutations: `requirePerm({ action })` checks
     `user.isSuper` → bypass; `role === 'external_user'` → 403; else
     `effectivePerms(user)` includes the (handle, action).
  3. For blueprint/user/group writes: `requireSuper()` checks `isSuper`.
  4. For collection reads: anonymous sees only unprotected entries;
     editors (non-super) must have `read` permission; external users see
     all (no per-collection gate); super sees all.

## 3. Recipes

### Promote a user to super

```sql
UPDATE users SET is_super = 1 WHERE email = 'someone@example.com';
```

Or in the admin: `/settings/users/:id` → check "Super user" → Save.

### Restrict an editor to one collection

1. Create a group: `/settings/groups/new` (handle e.g. `marketing`).
2. Toggle the `posts` row's `Read`, `Create`, `Update` (leave `Delete` off).
   Save.
3. Edit the user at `/settings/users/:id` → tick `marketing` → uncheck
   "Super user" → Save.

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

| Method | Path | Body |
| --- | --- | --- |
| POST | `/api/auth/sign-up/email` | `{email, password, name?}` — gated by `VULSE_ALLOW_PUBLIC_SIGNUP`. Creates an external user. |
| POST | `/api/auth/sign-in/email` | `{email, password}` — returns session cookie. |
| POST | `/api/auth/sign-out` | — |
| POST | `/api/auth/forget-password` | `{email, redirectTo}` |
| POST | `/api/auth/reset-password` | `{token, newPassword}` |
| GET | `/api/auth/me` | — returns `{user: AuthUser \| null, perms: Record<string, Action[]>}` |

### Users (super only)

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/users?role=editor&limit=50&offset=0` | — |
| POST | `/api/users` | `{email, password, name, role, isSuper, groupIds}` |
| GET | `/api/users/:id` | — |
| PATCH | `/api/users/:id` | `{name?, role?, isSuper?, groupIds?}` |
| DELETE | `/api/users/:id` | — |

### Groups (super only)

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/groups` | — |
| POST | `/api/groups` | `{handle, label}` |
| GET | `/api/groups/:handle` | — |
| PATCH | `/api/groups/:handle` | `{label}` |
| PUT | `/api/groups/:handle/permissions` | `{rows: {collectionHandle, canRead, canCreate, canUpdate, canDelete}[]}` |
| DELETE | `/api/groups/:handle` | — |

### Error shape

```json
{ "error": "auth_required" }     // 401
{ "error": "forbidden" }         // 403
{ "error": "signup_disabled" }   // 403 on /api/auth/sign-up/email when disabled
{ "error": "not_found" }         // 404
```

## 5. Middleware reference

Auth middleware is exported from `@vulse/auth`. To gate a custom Hono route
in your own extension:

```ts
import { sessionMiddleware, requireSuper, requirePerm } from '@vulse/auth';

app.use('*', sessionMiddleware(authInstance));            // global
app.get('/api/admin/widgets', requireSuper(), handler);   // super-only
app.get(
  '/api/collections/:handle/extra',
  requirePerm({ action: 'read', adapter }),
  handler,
);
```

`requirePerm` reads the `handle` URL param. If your route uses a different
param name, wrap the route with a custom guard that calls `effectivePerms`
directly:

```ts
import { effectivePerms } from '@vulse/auth';

app.get('/api/custom/:thing', async (c, next) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'auth_required' }, 401);
  if (!user.isSuper) {
    const perms = await effectivePerms(user, adapter);
    if (!perms.get('thing')?.has('read')) return c.json({ error: 'forbidden' }, 403);
  }
  await next();
});
```

## 6. Testing

### Sign-in fixture

The simplest way to get an authenticated session in tests:

```ts
import { createAuth, seedSuperUser, createUser } from '@vulse/auth';

// 1. Build the app with an in-memory DB + super-user seeded.
const db = new LibsqlAdapter({ url: ':memory:' });
await db.exec('PRAGMA foreign_keys = ON');
await runMigrations(db, MIGRATIONS_DIR);
const authInstance = createAuth({
  client: db.client,
  env: { authSecret: 's', baseUrl: 'http://x', allowPublicSignup: true, smtpUrl: undefined },
});
await seedSuperUser({
  adapter: db,
  bootstrapEmail: 'super@x.com',
  bootstrapPassword: 'hunter2hunter2',
  isProd: false,
});
const app = createApi({ blueprints, content, adapter: db, authInstance });

// 2. Sign in via the app's Hono instance to set the cookie.
const res = await app.request('http://x/api/auth/sign-in/email', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'super@x.com', password: 'hunter2hunter2' }),
});
const cookie = res.headers.get('set-cookie') ?? '';

// 3. Use the cookie on subsequent requests.
await app.request('http://x/api/collections/posts', { headers: { cookie } });
```

For non-super editors, use `createUser` from `@vulse/auth` services to
create the editor, then sign in as them. To exercise group permissions,
insert rows into `groups`, `user_groups`, and `group_permissions` directly
(or use the `groups` service).

For unit tests that don't need a full Hono round-trip, construct an
`AuthUser` object directly and inject it into `c.set('user', user)` via
custom middleware. See `packages/auth/src/__tests__/require-perm.test.ts`
for the pattern.
