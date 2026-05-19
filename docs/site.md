# Vulse built-in site (`@vulse/site`)

How to build a public-facing website with the SSR Vue app that ships
inside Vulse. The site lives in `packages/site` and runs as an
[h3](https://h3.unjs.io/) middleware in the same process as the admin
API. You can mount it as-is for a quick "throw a CMS up" deployment,
or treat it as a starting template and replace any view, route, or
block component with your own.

For authentication concepts and the underlying REST API, see
[`docs/auth.md`](./auth.md).

## 1. Mounting the site

```ts
import { createSiteServer } from '@vulse/site';
import {
  LibsqlAdapter,
  MIGRATIONS_DIR,
  databaseConfigFromEnv,
  runMigrations,
} from '@vulse/db';
import { createContentService, loadBlueprints, loadSets } from '@vulse/core';

const adapter = new LibsqlAdapter(databaseConfigFromEnv());
await adapter.exec('PRAGMA foreign_keys = ON');
await runMigrations(adapter, MIGRATIONS_DIR);

const sets = await loadSets({ adapter });
const blueprints = await loadBlueprints({ adapter, sets });
const content = createContentService(adapter, blueprints);

const site = createSiteServer({ blueprints, content });
// `site` is an h3 App — mount under your existing server, or wrap it
// in `toNodeListener(site)` to use it standalone.
```

### Static assets

The bundled client JS and CSS land under `dist/client/` after
`pnpm --filter @vulse/site build`. The renderer's HTML shell points
at `/_vulse/site/entry-client.js` and `/_vulse/site/style.css` by
default — serve `dist/client/` at that path (or pass
`{ clientEntry, stylesheet }` to `renderPage(...)` when calling the
renderer directly).

### Environment

Inherits the Vulse env vars documented in
[`docs/database.md`](./database.md) and [`docs/auth.md`](./auth.md).
The site itself doesn't add new env vars — yet (see "Planned
features" at the bottom).

## 2. Routing

The default routing table lives in
`packages/site/src/server/middleware/render.ts`:

| URL pattern | Route type | Resolution |
| --- | --- | --- |
| `/` | landing | If a `home` blueprint exists → render its singleton; else render the landing page. |
| `/<handle>` | list | When `<handle>` matches a blueprint, render `PostList.vue` with `entries`. |
| `/<slug>` | entry | When `pages` blueprint exists and contains a matching slug, render `PageDetail.vue`. |
| `/<collection>/<slug>` | entry | Render `PostDetail.vue` for the matching entry. |
| anything else | 404 | `NotFound.vue` |

### Custom route overrides

Pass `routes` to `createSiteServer` to take precedence over the
defaults. The override map is keyed by pathname:

```ts
createSiteServer({
  blueprints,
  content,
  routes: {
    '/about':       { collection: 'pages', slug: 'about' },
    '/blog':        { collection: 'posts', list: true },
    '/team/jane':   { collection: 'authors', slug: 'jane' },
  },
});
```

Each override resolves the entry (by `slug` or `id`) or list (when
`list: true`) and feeds the result into the same `SiteInitialState`
shape the built-in routes use, so `useEntry()` works in your view
unchanged.

## 3. Querying and filtering collections

### Reading the current route's state

Inside any view component, use the `useEntry()` composable:

```ts
import { useEntry } from '@vulse/site';
// (path: packages/site/src/composables/useEntry.ts)

const { state, entry, entries } = useEntry();
// state.route.type    : 'landing' | 'entry' | 'list' | 'not-found'
// state.route.collection: string | undefined
// state.route.slug    : string | undefined
// entry               : Entry | null  (set for 'entry' routes)
// entries             : Entry[]       (set for 'list' routes)
// state.blueprints    : BlueprintMeta[]
```

### Looking up entries imperatively

Two helpers are exported from the same module and used by the SSR
middleware. They're public — call them from your own h3 handlers
or `routes` overrides:

```ts
import { findPublicEntryBySlug, getPublicEntryById } from '@vulse/site';

const post = await findPublicEntryBySlug(content, 'posts', 'hello-world');
const draft = await findPublicEntryBySlug(content, 'posts', 'draft', {
  includeProtected: true, // bypass the protected-entry filter
});
const byId = await getPublicEntryById(content, 'posts', '01HPK...', {
  includeProtected: true,
});
```

### Substring search via the content service

`ContentService.list` accepts a substring `q` and an optional
`field`:

```ts
const result = await content.list('posts', {
  q: 'climate',
  field: 'title',     // search a single field
  limit: 20,
  offset: 0,
});
// result.items   : Entry[]
// result.total   : number
// result.limit   : 20
// result.offset  : 0
```

When `field` is omitted, the search unions across all searchable
fields on the blueprint. **Searchable field kinds** (in
`packages/core/src/content/service.ts`):

- `text`
- `textarea`
- `select`
- `relationship`
- `date`

Plus the literal `id` and `updatedAt` columns.

### Structured filtering and sorting

`content.list(handle, opts)` supports a strict set of operators on
both top-level columns and any declared blueprint field.

#### Allowed keys

Top-level entry columns (always available; system-owned — system
columns ALWAYS win over a blueprint field with the same name):
`id`, `parent_id` (alias `parentId`), `protected`, `sort_order`
(alias `sortOrder`), `created_at` (alias `createdAt`), `updated_at`
(alias `updatedAt`).

Plus every field declared in the blueprint, including `status` (which
lives in the content JSON, not the row column — blueprint declarations
win for that name).

#### Operators

| Op | SQL | Meaning |
| --- | --- | --- |
| `eq` | `=` | exact match |
| `neq` | `!=` | not equal |
| `in` | `IN (…)` | any of |
| `gt`, `gte`, `lt`, `lte` | `>`, `>=`, `<`, `<=` | comparison (lex on strings, numeric on numeric cols) |

Operators inside one field AND together
(`{gte: '2024-01-01', lt: '2025-01-01'}` is "within 2024"). Filters
across different fields AND together. Empty `in: []` matches nothing.

Comparison operators (`gt`/`gte`/`lt`/`lte`) on boolean fields are
rejected with a validation error.

#### From the content service

```ts
const result = await content.list('posts', {
  filter: {
    status: { in: ['published', 'scheduled'] },
    publishedAt: { gte: '2024-01-01' },
  },
  sort: [{ field: 'publishedAt', direction: 'desc' }],
  limit: 20,
});
```

#### From the REST API

Bracket-nested filter syntax + comma-separated values for `in`:

```
GET /api/collections/posts
  ?filter[status][in]=published,scheduled
  &filter[publishedAt][gte]=2024-01-01
  &sort=-publishedAt
  &limit=20
```

Sort accepts comma-separated fields; prefix with `-` for descending.
Combine multiple sort keys with commas:

```
GET /api/collections/posts?sort=-publishedAt,title
  # ORDER BY publishedAt DESC, title ASC
```

#### From a `SiteRouteOverride`

Pre-configure filtered routes in your `vulse.config.ts`:

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

#### Error responses

| Status | Body | When |
| --- | --- | --- |
| 422 | `{error: 'validation', issues: [...]}` | filter / sort field not in the blueprint or top-level whitelist |
| 422 | `{error: 'validation', issues: [...]}` | value can't be coerced (e.g. `gt` on a boolean field) |
| 422 | `{error: 'validation', issues: [...]}` | query string doesn't match `filter[<field>][<op>]=…` |

The Vulse REST API maps all `ValidationError` instances to HTTP 422.
The `issues` array surfaces the per-field details (Zod issue shape).

Strict 422 on unknown fields is intentional — silently ignoring a
typo would return more data than you asked for, which is the worst
kind of correctness bug.

#### Index coverage

Filters on top-level columns (especially `protected`) hit the
existing indexes. Filters on content fields run `json_extract` per
row; that's fine for the entry sizes Vulse handles today (single-
machine libsql, thousands per collection). Heavy content-field
filtering at scale would want a dedicated indexed-column migration.

## 4. Block-level customization

The site's `EntryBody.vue` renders entry body content via
`<BlockRenderer>` from `@vulse/renderer`. To customize how a block
type renders on the public site, pass a `components` override map.

`PostDetail.vue` already demonstrates the pattern:

```vue
<script setup lang="ts">
import type { BlockComponentMap } from '@vulse/renderer';
import MyAccordion from '../components/MyAccordion.vue';
import EntryBody from './EntryBody.vue';

const blockComponents = {
  vulseAccordion: MyAccordion,
} satisfies BlockComponentMap;
</script>

<template>
  <EntryBody :value="body" :components="blockComponents" />
</template>
```

Your override component receives `:node` (the ProseMirror node) and
can use `<Node>` from `@vulse/renderer` to recurse into the node's
children:

```vue
<!-- MyAccordion.vue -->
<script setup lang="ts">
import { type BlockNode, Node as RendererNode } from '@vulse/renderer';
import { computed } from 'vue';

const props = defineProps<{ node: BlockNode }>();
const summary = computed(() => String(props.node.attrs?.summary ?? 'Accordion'));
</script>

<template>
  <details data-site-accordion>
    <summary>{{ summary }}</summary>
    <RendererNode v-for="(child, i) in node.content ?? []" :key="i" :node="child" />
  </details>
</template>
```

### Bard sets

For custom blocks defined as **Bard sets**, register one component
per set name with the `set:<handle>` key:

```ts
const blockComponents = {
  vulseAccordion: MyAccordion,
  'set:quote':    MyQuoteCard,
  'set:gallery':  MyGallery,
} satisfies BlockComponentMap;
```

Each set component receives `:data` (the field values authored
inside the set). Missing handlers render a hidden
`<div data-vulse-missing-set="<handle>" />` placeholder.

### CSS-only styling (no component swap)

Every default block component emits a `data-*` attribute you can
target from your site stylesheet without writing any Vue. Examples:

- `<aside data-vulse-callout data-tone="info|warn">…</aside>`
- `<details data-vulse-accordion …>`
- `<div data-vulse-accordion-group>…</div>`
- `<div data-vulse-video src="…">…</div>`
- `<div data-vulse-iframe src="…">…</div>`

```css
/* Drop-cap inside callouts */
aside[data-vulse-callout] p:first-of-type::first-letter {
  font-size: 3rem;
  float: left;
  line-height: 1;
}
```

## 5. External user login (current state + workaround)

The site package **does not ship a sign-in flow** today. Specifically:

- No `/login` route or form.
- The SSR renderer does not read the `vulse_session` cookie set by
  Better Auth.
- `content.list` and `content.get` calls inside the renderer pass
  `includeProtected` based on whether the URL has `?preview=1` — not
  based on the signed-in user (see the security note in
  [Planned features](#planned-features)).

### Workaround: sign in via the admin API + reuse the cookie

The admin's `/api/auth/sign-in/email` endpoint sets the
`vulse_session` cookie on the response. A custom site view can post
to it directly:

```ts
// In your custom /login view:
async function submit(email: string, password: string) {
  const res = await fetch('/api/auth/sign-in/email', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('Sign-in failed');
  // The vulse_session cookie is now set on the browser.
  location.href = '/';
}
```

After sign-in the cookie is on the browser. To make protected entries
actually visible during SSR, you'll currently need to wire the cookie
through to `includeProtected` yourself — typically with a custom
`routes` override (or a custom h3 handler that wraps
`createSiteRenderer`):

```ts
import { resolveSiteRequest } from '@vulse/site';

app.use(defineEventHandler(async (event) => {
  const cookieHeader = getRequestHeader(event, 'cookie') ?? '';
  const signedIn = cookieHeader.includes('vulse_session=');
  // Build SiteServerDeps with includeProtected derived from signedIn:
  const deps = { blueprints, content, /* … */ };
  const url = getRequestURL(event);
  const result = await resolveSiteRequest(deps, url);
  // …
}));
```

A first-class sign-in surface (a `/login` route, a `useAuth()`
composable that hydrates the current user, and an `includeProtected`
that derives from `getSession()` instead of `?preview=1`) is on the
roadmap — see [Planned features](#planned-features).

For the underlying auth endpoints (sign-up, password reset, etc.),
see [`docs/auth.md`](./auth.md#4-api-reference).

## 6. SEO headers

The SSR shell emits a minimal `<head>`:

- `<meta charset="UTF-8" />`
- `<meta name="viewport" content="width=device-width,initial-scale=1.0" />`
- `<title>` derived from `entry.content.title || entry.content.headline || 'Vulse site'`
- `<link rel="stylesheet" />` pointing at the bundled CSS

There's no built-in `<meta name="description">`, OpenGraph,
Twitter card, or `<link rel="canonical">` yet. Two ways to add them
today:

### Path A: replace the HTML shell

`renderPage(url, state, options)` returns the full HTML string —
which means you can write your own h3 handler that builds a
different shell around the rendered app:

```ts
import { renderPage, resolveSiteRequest } from '@vulse/site';

app.use(defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  const { status, state } = await resolveSiteRequest(deps, url);
  setResponseStatus(event, status);
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');

  // Build your own <head> from `state.entry.content`:
  const content = state.entry?.content ?? {};
  const title = String(content.seo_title ?? content.title ?? content.headline ?? 'Vulse site');
  const description = String(content.seo_description ?? content.excerpt ?? '');
  const image = String(content.seo_image ?? content.cover_image ?? '');

  // Then either:
  //   (a) call renderPage and return the default shell + post-process the string, or
  //   (b) lift the renderToString call from packages/site/src/entry-server.ts and
  //       inline your own shell.
  return await renderPage(`${url.pathname}${url.search}`, state);
}));
```

This is the "fork the shell" path. It's the only option today if you
want server-rendered meta tags.

### Path B: client-side fallback

For client-only sites (where SEO crawlers running JS is acceptable),
set the head in `onMounted`:

```ts
import { onMounted } from 'vue';
import { useEntry } from '@vulse/site';

const { entry } = useEntry();
onMounted(() => {
  if (entry.value?.content.title) {
    document.title = String(entry.value.content.title);
  }
});
```

Most search-engine crawlers do execute JS, but social-share crawlers
(Twitter, Slack, Discord) do not. If OpenGraph matters, use Path A.

A `<VulseSeo>` component that reads convention fields and a proper
SSR head-injection mechanism are planned — see
[Planned features](#planned-features).

## Planned features

These behaviors are not yet implemented; this section is the
authoritative list of known gaps so you can plan around them.

### Authenticated reads on the site (security note)

**The `?preview=1` query parameter currently bypasses the protected
entry filter without requiring auth.** Anyone can append it and read
protected entries. Fix is queued: the site renderer should read
`vulse_session` and resolve a user via Better Auth's `getSession`;
`includeProtected` should then be derived from "is there a signed-in
user?" and `?preview=1` should require an editor or super-user
session. Until the fix ships, treat protected entries as not
secret-grade — anyone who knows the convention can read them.

### `<VulseSeo>` component

A convention-based head-injection component that emits
`<title>`, `<meta name="description">`, OpenGraph, Twitter card,
and `<link rel="canonical">` from entry fields with a documented
fallback chain (`seo_title → title → headline`, etc.).

### Site-side `/login` route + `useAuth()` composable

A built-in sign-in form, sign-out, forgot/reset flows mirroring the
admin's auth pages but theme-aligned with the public site. Bundled
with a `useAuth()` composable that exposes the current user during
SSR + hydration.

---

If you need any of these sooner, open an issue or look at the
matching tasks in the project's `docs/superpowers/specs/` directory
to see whether a design has already been sketched.
