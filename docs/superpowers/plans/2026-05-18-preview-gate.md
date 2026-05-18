# Preview Gate Security Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate `?preview=1` on a signed-in editor or super session so anonymous visitors can no longer read protected entries.

**Architecture:** Add an optional `authInstance` to `SiteServerDeps`; replace the pure-query-string `includeProtected()` helper with an async `resolvePreview()` that calls `auth.api.getSession()` when `authInstance` is present. No authInstance → preview silently ignored (safe default). Wire the authInstance through the Vite dev plugin and prod server. Update existing tests and add five new gate tests using a mock authInstance.

**Tech Stack:** TypeScript, h3, better-auth (`AuthInstance`), vitest

---

## File Map

| File | Change |
|---|---|
| `packages/site/package.json` | Add `"@vulse/auth": "workspace:*"` to `dependencies` |
| `packages/site/src/types.ts` | Add `authInstance?: AuthInstance` to `SiteServerDeps` |
| `packages/site/src/server/middleware/render.ts` | Replace `includeProtected()` with async `resolvePreview()`; update `resolveSiteRequest` signature; update `createSiteRenderer` to forward headers |
| `packages/site/src/server/middleware/render.test.ts` | Fix the one test that expected preview=1 to work without auth; add 5 new gate tests |
| `packages/core/src/vite/plugin.ts` | Add `authInstance` to `createApp` callback deps type; pass it in `build()` |
| `apps/dev/vite.config.ts` | Destructure `authInstance` from callback and pass to `createSiteServer` |
| `apps/dev/src/server.prod.ts` | Pass `authInstance` to `createSiteServer` |

---

### Task 1: Add @vulse/auth to site package dependencies

**Files:**
- Modify: `packages/site/package.json`

- [ ] **Step 1: Add the dependency**

In `packages/site/package.json`, add `"@vulse/auth": "workspace:*"` inside the `"dependencies"` block (after `"@vulse/core": "workspace:*"`):

```json
  "dependencies": {
    "@vue/server-renderer": "^3.5.0",
    "@vulse/auth": "workspace:*",
    "@vulse/core": "workspace:*",
    "@vulse/renderer": "workspace:*",
    "h3": "^1.15.11",
    "vue": "^3.5.0",
    "vue-router": "^4.4.5"
  },
```

- [ ] **Step 2: Run pnpm install to update the lockfile**

Run: `cd /home/espen/jsdev/vulsecms && pnpm install`
Expected: lockfile updated, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/site/package.json pnpm-lock.yaml
git commit -m "chore(site): add @vulse/auth workspace dep"
```

---

### Task 2: Extend SiteServerDeps with optional authInstance

**Files:**
- Modify: `packages/site/src/types.ts`

- [ ] **Step 1: Write the failing type-check**

We rely on the TypeScript compiler as the "test" here. First just verify current state passes:

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/site check`
Expected: PASS (baseline).

- [ ] **Step 2: Add the import and field**

Replace the current contents of `packages/site/src/types.ts`:

```ts
import type { AuthInstance } from '@vulse/auth';
import type { Blueprint, BlueprintMeta, ContentService, Entry } from '@vulse/core';

export interface SiteRouteOverride {
  collection: string;
  id?: string;
  slug?: string;
  list?: boolean;
}

export type SiteRouteOverrides = Record<string, SiteRouteOverride>;

export interface SiteRouteState {
  type: 'landing' | 'entry' | 'list' | 'not-found';
  collection?: string | undefined;
  slug?: string | undefined;
}

export interface SiteInitialState {
  route: SiteRouteState;
  blueprints: BlueprintMeta[];
  entry: Entry | null;
  entries: Entry[];
}

export interface SiteServerDeps {
  blueprints: Map<string, Blueprint>;
  content: ContentService;
  routes?: SiteRouteOverrides;
  authInstance?: AuthInstance;
}

export interface RenderPageOptions {
  clientEntry?: string;
  stylesheet?: string;
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/site check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/site/src/types.ts
git commit -m "feat(site): add authInstance field to SiteServerDeps"
```

---

### Task 3: Replace includeProtected with async resolvePreview in render.ts

**Files:**
- Modify: `packages/site/src/server/middleware/render.ts`

- [ ] **Step 1: Replace the file with the new implementation**

Replace the entire contents of `packages/site/src/server/middleware/render.ts`:

```ts
import { fileURLToPath } from 'node:url';
import {
  type App,
  type EventHandler,
  createApp,
  defineEventHandler,
  getRequestHeaders,
  getRequestURL,
  setResponseHeader,
  setResponseStatus,
} from 'h3';
import { findPublicEntryBySlug, getPublicEntryById } from '../../composables/useEntry.js';
import { renderPage } from '../../entry-server.js';
import type { SiteInitialState, SiteRouteOverride, SiteServerDeps } from '../../types.js';

export const SITE_CLIENT_BASE = '/_vulse/site/';
export type { SiteRouteOverrides } from '../../types.js';

export function resolveSiteClientRoot(): string {
  return fileURLToPath(new URL('../../client/', import.meta.url));
}

function toMeta(blueprint: SiteServerDeps['blueprints'] extends Map<string, infer T> ? T : never) {
  return {
    handle: blueprint.handle,
    label: blueprint.label,
    singleton: blueprint.singleton,
    tree: blueprint.tree,
    ...(blueprint.maxDepth !== undefined ? { maxDepth: blueprint.maxDepth } : {}),
    fields: blueprint.fields,
  };
}

function normalizePath(pathname: string): string {
  if (pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function toRouteKey(pathname: string): string {
  return normalizePath(decodeURIComponent(pathname));
}

function segments(pathname: string): string[] {
  return normalizePath(pathname)
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(decodeURIComponent);
}

/**
 * Resolves whether the request is allowed to see protected entries.
 *
 * Rules:
 * - If ?preview=1 is absent → always false.
 * - If authInstance is not provided → false (safe default; useful in test / partial setups).
 * - If the session resolves to a user with isSuper === true/1 OR role === 'editor' → true.
 * - Signed-in external_users are NOT granted preview access (preview is an editorial workflow).
 * - No cookie / unauthenticated → false.
 */
async function resolvePreview(
  deps: SiteServerDeps,
  url: URL,
  headers: Headers | undefined,
): Promise<boolean> {
  if (url.searchParams.get('preview') !== '1') return false;
  if (!deps.authInstance || !headers) return false;
  const result = await deps.authInstance.auth.api.getSession({ headers });
  const user = (result?.user ?? null) as { role?: string; isSuper?: unknown } | null;
  if (!user) return false;
  const isSuper = Number(user.isSuper) === 1 || user.isSuper === true;
  return isSuper || user.role === 'editor';
}

async function resolveOverride(
  deps: SiteServerDeps,
  override: SiteRouteOverride,
  preview: boolean,
): Promise<SiteInitialState> {
  const blueprints = [...deps.blueprints.values()].map(toMeta);
  if (override.list) {
    const result = await deps.content.list(override.collection, {
      limit: 100,
      includeProtected: preview,
    });
    return {
      route: { type: 'list', collection: override.collection },
      blueprints,
      entry: null,
      entries: result.items,
    };
  }

  const entry = override.id
    ? await getPublicEntryById(deps.content, override.collection, override.id, {
        includeProtected: preview,
      })
    : override.slug
      ? await findPublicEntryBySlug(deps.content, override.collection, override.slug, {
          includeProtected: preview,
        })
      : null;

  return {
    route: {
      type: entry ? 'entry' : 'not-found',
      collection: override.collection,
      slug: override.slug,
    },
    blueprints,
    entry,
    entries: [],
  };
}

export async function resolveSiteRequest(
  deps: SiteServerDeps,
  url: URL,
  headers?: Headers,
): Promise<{ status: number; state: SiteInitialState }> {
  const blueprints = [...deps.blueprints.values()].map(toMeta);
  const preview = await resolvePreview(deps, url, headers);
  const pathname = toRouteKey(url.pathname);
  const override = deps.routes?.[pathname];
  if (override) {
    const state = await resolveOverride(deps, override, preview);
    return { status: state.route.type === 'not-found' ? 404 : 200, state };
  }

  const parts = segments(pathname);
  if (parts.length === 0) {
    if (deps.blueprints.has('home')) {
      const result = await deps.content.list('home', { limit: 1, includeProtected: preview });
      const entry = result.items[0] ?? null;
      return {
        status: entry ? 200 : 200,
        state: {
          route: { type: entry ? 'entry' : 'landing', collection: 'home' },
          blueprints,
          entry,
          entries: [],
        },
      };
    }

    return {
      status: 200,
      state: { route: { type: 'landing' }, blueprints, entry: null, entries: [] },
    };
  }

  if (parts.length === 1) {
    const [slugOrHandle] = parts;
    if (slugOrHandle && deps.blueprints.has(slugOrHandle)) {
      const result = await deps.content.list(slugOrHandle, {
        limit: 100,
        includeProtected: preview,
      });
      return {
        status: 200,
        state: {
          route: { type: 'list', collection: slugOrHandle },
          blueprints,
          entry: null,
          entries: result.items,
        },
      };
    }

    if (slugOrHandle && deps.blueprints.has('pages')) {
      const entry = await findPublicEntryBySlug(deps.content, 'pages', slugOrHandle, {
        includeProtected: preview,
      });
      return {
        status: entry ? 200 : 404,
        state: {
          route: { type: entry ? 'entry' : 'not-found', collection: 'pages', slug: slugOrHandle },
          blueprints,
          entry,
          entries: [],
        },
      };
    }
  }

  if (parts.length === 2) {
    const [collection, slug] = parts;
    if (collection && slug && deps.blueprints.has(collection)) {
      const entry = await findPublicEntryBySlug(deps.content, collection, slug, {
        includeProtected: preview,
      });
      return {
        status: entry ? 200 : 404,
        state: {
          route: { type: entry ? 'entry' : 'not-found', collection, slug },
          blueprints,
          entry,
          entries: [],
        },
      };
    }
  }

  return {
    status: 404,
    state: { route: { type: 'not-found' }, blueprints, entry: null, entries: [] },
  };
}

export function createSiteRenderer(deps: SiteServerDeps): EventHandler {
  return defineEventHandler(async (event) => {
    const url = getRequestURL(event);
    const rawHeaders = getRequestHeaders(event);
    const headers = new Headers();
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (typeof v === 'string') headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(','));
    }
    const { status, state } = await resolveSiteRequest(deps, url, headers);
    setResponseStatus(event, status);
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
    return await renderPage(`${url.pathname}${url.search}`, state);
  });
}

export function createSiteServer(deps: SiteServerDeps): App {
  const app = createApp();
  app.use(createSiteRenderer(deps));
  return app;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/site check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/site/src/server/middleware/render.ts
git commit -m "feat(site): replace includeProtected with async resolvePreview gated on auth session"
```

---

### Task 4: Update render.test.ts — fix broken test and add gate tests

**Files:**
- Modify: `packages/site/src/server/middleware/render.test.ts`

**Context:** The existing test "resolves protected entries in preview mode" at line 72 passes `?preview=1` with NO authInstance. Under the new rules, this must be 404 (preview denied without auth). We fix that expectation and add 5 new gate tests using a lightweight mock `authInstance` (no real DB needed).

- [ ] **Step 1: Run existing tests to see the expected failure**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/site test`
Expected: FAIL — "resolves protected entries in preview mode" now returns 404, not 200.

- [ ] **Step 2: Replace the test file with corrected + extended tests**

Replace the entire contents of `packages/site/src/server/middleware/render.test.ts`:

```ts
import type { AuthInstance } from '@vulse/auth';
import type { Blueprint, ContentService, Entry } from '@vulse/core';
import { describe, expect, it } from 'vitest';
import { resolveSiteRequest } from './render.js';

function entry(id: string, collection: string, slug: string, protectedEntry = false): Entry {
  return {
    id,
    collection,
    parentId: null,
    sortOrder: 1,
    status: 'published',
    protected: protectedEntry,
    content: { title: id, slug, body: [] },
    createdAt: '',
    updatedAt: '',
  };
}

const publicPost = entry('public', 'posts', 'hello');
const protectedPost = entry('secret', 'posts', 'secret', true);

const content: Pick<ContentService, 'list' | 'get'> = {
  async list(handle, opts) {
    const items = [publicPost, protectedPost].filter((item) => {
      if (item.collection !== handle) return false;
      if (item.protected && !opts?.includeProtected) return false;
      if (opts?.field === 'slug' && opts.q) return item.content.slug === opts.q;
      return true;
    });
    return { items, total: items.length, limit: opts?.limit ?? 25, offset: opts?.offset ?? 0 };
  },
  async get(handle, id) {
    return (
      [publicPost, protectedPost].find((item) => item.collection === handle && item.id === id) ??
      null
    );
  },
};

const blueprints = new Map<string, Blueprint>([
  [
    'posts',
    {
      handle: 'posts',
      label: 'Posts',
      singleton: false,
      fields: [],
      hash: '',
      schema: {} as never,
    },
  ],
]);

/**
 * Build a mock AuthInstance whose getSession returns the given user shape.
 * We use `as unknown as AuthInstance` because we only need the narrow
 * `auth.api.getSession` surface that resolvePreview calls. No real DB needed.
 */
function mockAuth(user: { role: string; isSuper: boolean | number } | null): AuthInstance {
  return {
    auth: {
      api: {
        getSession: async (_opts: unknown) => (user ? { user } : null),
      },
    },
  } as unknown as AuthInstance;
}

const deps = { blueprints, content: content as ContentService };

describe('resolveSiteRequest', () => {
  it('resolves collection slug routes to public entries', async () => {
    const result = await resolveSiteRequest(deps, new URL('http://x/posts/hello'));
    expect(result.status).toBe(200);
    expect(result.state.entry?.id).toBe('public');
  });

  it('does not resolve protected entries without preview', async () => {
    const result = await resolveSiteRequest(deps, new URL('http://x/posts/secret'));
    expect(result.status).toBe(404);
  });

  // --- Gate tests: ?preview=1 is only honoured for editors/supers ---

  it('ignores ?preview=1 when no authInstance is provided (safe default)', async () => {
    // deps has no authInstance — anonymous visitors cannot bypass protection
    const result = await resolveSiteRequest(
      deps,
      new URL('http://x/posts/secret?preview=1'),
    );
    expect(result.status).toBe(404);
  });

  it('ignores ?preview=1 when authInstance is present but there is no session cookie', async () => {
    // getSession returns null → not signed in
    const depsWithAuth = { ...deps, authInstance: mockAuth(null) };
    const result = await resolveSiteRequest(
      depsWithAuth,
      new URL('http://x/posts/secret?preview=1'),
      new Headers(), // no cookie header
    );
    expect(result.status).toBe(404);
  });

  it('ignores ?preview=1 for a signed-in external_user (not an editorial role)', async () => {
    const depsWithAuth = {
      ...deps,
      authInstance: mockAuth({ role: 'external_user', isSuper: false }),
    };
    const headers = new Headers({ cookie: 'vulse_session=fake-external-token' });
    const result = await resolveSiteRequest(
      depsWithAuth,
      new URL('http://x/posts/secret?preview=1'),
      headers,
    );
    expect(result.status).toBe(404);
  });

  it('honours ?preview=1 for a signed-in editor', async () => {
    const depsWithAuth = {
      ...deps,
      authInstance: mockAuth({ role: 'editor', isSuper: false }),
    };
    const headers = new Headers({ cookie: 'vulse_session=fake-editor-token' });
    const result = await resolveSiteRequest(
      depsWithAuth,
      new URL('http://x/posts/secret?preview=1'),
      headers,
    );
    expect(result.status).toBe(200);
    expect(result.state.entry?.id).toBe('secret');
  });

  it('honours ?preview=1 for a super user (any role)', async () => {
    const depsWithAuth = {
      ...deps,
      authInstance: mockAuth({ role: 'external_user', isSuper: true }),
    };
    const headers = new Headers({ cookie: 'vulse_session=fake-super-token' });
    const result = await resolveSiteRequest(
      depsWithAuth,
      new URL('http://x/posts/secret?preview=1'),
      headers,
    );
    expect(result.status).toBe(200);
    expect(result.state.entry?.id).toBe('secret');
  });
});
```

- [ ] **Step 3: Run the tests and verify all pass**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/site test`
Expected: 7 tests PASS (2 original + 5 gate tests).

- [ ] **Step 4: Commit**

```bash
git add packages/site/src/server/middleware/render.test.ts
git commit -m "test(site): update preview test; add 5 auth-gate cases for resolvePreview"
```

---

### Task 5: Update Vite plugin createApp callback to include authInstance

**Files:**
- Modify: `packages/core/src/vite/plugin.ts`

- [ ] **Step 1: Update the VulseDevOptions site.createApp type and the build() call**

In `packages/core/src/vite/plugin.ts`, change the `site` interface from:

```ts
  site?: {
    base?: string;
    clientAssetsDir?: string;
    createApp: (deps: {
      blueprints: Map<string, Blueprint>;
      content: ContentService;
    }) => App | Promise<App>;
  };
```

to:

```ts
  site?: {
    base?: string;
    clientAssetsDir?: string;
    createApp: (deps: {
      blueprints: Map<string, Blueprint>;
      content: ContentService;
      authInstance: ReturnType<typeof createAuth>;
    }) => App | Promise<App>;
  };
```

And change line 107 from:

```ts
        const site = opts.site ? await opts.site.createApp({ blueprints, content }) : null;
```

to:

```ts
        const site = opts.site
          ? await opts.site.createApp({ blueprints, content, authInstance: authInstance! })
          : null;
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/core check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/vite/plugin.ts
git commit -m "feat(core/vite): thread authInstance into site.createApp callback"
```

---

### Task 6: Update apps/dev/vite.config.ts

**Files:**
- Modify: `apps/dev/vite.config.ts`

- [ ] **Step 1: Destructure authInstance and pass it to createSiteServer**

Change the `createApp` callback from:

```ts
        createApp: ({ blueprints, content }) =>
          createSiteServer({
            blueprints,
            content,
            routes: (config as { routes?: SiteRouteOverrides }).routes,
          }),
```

to:

```ts
        createApp: ({ blueprints, content, authInstance }) =>
          createSiteServer({
            blueprints,
            content,
            authInstance,
            routes: (config as { routes?: SiteRouteOverrides }).routes,
          }),
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/dev check 2>/dev/null || pnpm --filter @vulse/site check && pnpm --filter @vulse/core check`

(apps/dev may not have a `check` script — the important thing is that site and core check green.)

- [ ] **Step 3: Commit**

```bash
git add apps/dev/vite.config.ts
git commit -m "fix(dev): pass authInstance from vite plugin into createSiteServer"
```

---

### Task 7: Update apps/dev/src/server.prod.ts

**Files:**
- Modify: `apps/dev/src/server.prod.ts`

- [ ] **Step 1: Pass authInstance to createSiteServer**

Change line 81 from:

```ts
  const site = createSiteServer({ blueprints, content, routes: routeOverrides });
```

to:

```ts
  const site = createSiteServer({ blueprints, content, routes: routeOverrides, authInstance });
```

- [ ] **Step 2: Verify typecheck (site package)**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/site check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/dev/src/server.prod.ts
git commit -m "fix(dev): pass authInstance to createSiteServer in prod server"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Build site package**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/site build`
Expected: PASS, no TypeScript errors.

- [ ] **Step 2: Build core package**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/core build`
Expected: PASS.

- [ ] **Step 3: Run site tests**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/site test`
Expected: 7 tests pass.

- [ ] **Step 4: Run core tests**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/core test`
Expected: all pass.

- [ ] **Step 5: Typecheck site**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/site check`
Expected: PASS.

- [ ] **Step 6: Typecheck core**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/core check`
Expected: PASS.

- [ ] **Step 7: Run dev tests if any**

Run: `cd /home/espen/jsdev/vulsecms && pnpm --filter @vulse/dev test 2>/dev/null || echo "no dev tests"`
Expected: PASS or "no dev tests".

---

## Self-Review Notes

- **Task 4 test fixture:** Uses a mock `authInstance` shape (`as unknown as AuthInstance`) with a hand-crafted `getSession`. This avoids a real SQLite DB in the site-package tests. The mock only implements the surface `resolvePreview` actually calls (`auth.api.getSession`). A comment in the test documents this choice.
- **Type consistency:** `resolvePreview` signature uses `deps: SiteServerDeps`, `url: URL`, `headers: Headers | undefined` — all three tasks (3, 4) agree on this shape. `resolveSiteRequest` adds `headers?: Headers` as optional third arg — tests in task 4 use it correctly.
- **isSuper normalisation:** `Number(user.isSuper) === 1 || user.isSuper === true` handles both the DB integer `1` returned by better-auth and a boolean `true` from mock fixtures.
- **No authInstance path:** When `deps.authInstance` is absent, `resolvePreview` returns `false` before calling any network/DB code. Existing test setup without auth continues to work as before (protected entries stay hidden).
- **Spec gap check:** All 8 spec steps covered: dep add (T1), types (T2), renderer (T3), tests (T4), vite plugin (T5), vite.config (T6), server.prod (T7), verification (T8).
