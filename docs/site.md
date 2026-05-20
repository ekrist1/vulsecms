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
import { type SiteConfig, createSiteServer } from '@vulse/site';
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
const siteConfig = {
  url: 'https://example.com',
  name: 'Example',
  locale: 'en',
  titleTemplate: '%s | Example',
  defaultDescription: 'Example runs on Vulse.',
} satisfies SiteConfig;

const site = createSiteServer({ blueprints, content, site: siteConfig });
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
Draft preview links also use `VULSE_PREVIEW_SECRET` (falling back to
`VULSE_SESSION_SECRET`) when preview tokens are enabled.

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

Pass `site.routes` to `createSiteServer` to take precedence over the
defaults. The override map is keyed by pathname. The older top-level
`routes` option still works, but `site.routes` wins when both define
the same path.

```ts
createSiteServer({
  blueprints,
  content,
  site: {
    routes: {
      '/about':     { collection: 'pages', slug: 'about' },
      '/blog':      { collection: 'posts', list: true },
      '/team/jane': { collection: 'authors', slug: 'jane' },
    },
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
  site: {
    routes: {
      '/blog': {
        collection: 'posts',
        list: true,
        filter: { status: { eq: 'published' } },
        sort: [{ field: 'publishedAt', direction: 'desc' }],
      },
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
- The default public routes do not expose protected entries to signed-in
  external users.
- `?preview=1` is an editorial preview gate only. It requires an editor
  or super-user session and does not grant access to `external_user`
  accounts.

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

After sign-in the cookie is on the browser. To render member-only or
account-specific content on the public site, create a custom h3 handler
or custom route that calls Better Auth's `getSession()` and then decides
which content to fetch. Keep this separate from editorial preview:

```ts
import { createError, defineEventHandler, getRequestHeader, getRequestURL } from 'h3';
import { resolveSiteRequest } from '@vulse/site';

app.use(defineEventHandler(async (event) => {
  const headers = new Headers();
  const cookie = getRequestHeader(event, 'cookie');
  if (cookie) headers.set('cookie', cookie);
  const session = await authInstance.auth.api.getSession({ headers });
  if (!session?.user) throw createError({ statusCode: 401 });

  // Fetch and render the content this user is allowed to see:
  const deps = { blueprints, content, /* … */ };
  const url = getRequestURL(event);
  const result = await resolveSiteRequest(deps, url);
  // …
}));
```

A first-class sign-in surface (a `/login` route, a `useAuth()`
composable that hydrates the current user, and member-route helpers) is
still planned. The core auth endpoints are already usable from custom
frontend components.

For the underlying auth endpoints (sign-up, password reset, etc.),
see [`docs/auth.md`](./auth.md#4-api-reference).

## 6. SEO and head tags

The SSR shell now resolves the document head server-side through
`resolveHead(state, siteConfig, requestUrl)`. This means social crawlers
see the same metadata as search crawlers and users.

`renderPage(...)` emits:

- `<title>`
- `<meta name="description">`
- `<meta name="robots">`
- OpenGraph tags (`og:title`, `og:description`, `og:image`, `og:url`,
  `og:type`, `og:site_name`)
- Twitter card tags
- `<link rel="canonical">`
- JSON-LD from entry content

### Site defaults

Configure global defaults in `vulse.config.ts`:

```ts
import type { SiteConfig } from '@vulse/site/server';

const site = {
  url: 'https://example.com',
  name: 'Example',
  locale: 'en',
  titleTemplate: '%s | Example',
  defaultTitle: 'Example',
  defaultDescription: 'Content powered by Vulse.',
  defaultImage: 'https://example.com/og-default.jpg',
  seo: {
    robots: 'index, follow',
    twitterCard: 'summary_large_image',
  },
} satisfies SiteConfig;

export default {
  // ...
  site,
};
```

### Entry field conventions

Add SEO fields to the blueprints that need custom metadata. Vulse reads
these fields by convention; it does not require a special SEO field type.

| Purpose | Preferred field | Fallbacks |
| --- | --- | --- |
| Title | `seoTitle` | `seo_title`, `title`, `headline`, `site.defaultTitle`, `site.name` |
| Description | `seoDescription` | `seo_description`, `description`, `excerpt`, `site.defaultDescription` |
| Image | `seoImage` | `seo_image`, `ogImage`, `og_image`, `coverImage`, `cover_image`, `site.defaultImage` |
| Canonical | `canonicalUrl` | `canonical_url`, generated from `site.url + pathname` |
| Robots | `noindex` | route status, preview URL, `site.seo.robots` |
| JSON-LD | `jsonLd` | `json_ld`, `structuredData`, `structured_data` |

Example blueprint fields:

```ts
seoTitle: z.string().optional().meta({ ui: { kind: 'text' } }),
seoDescription: z.string().optional().meta({ ui: { kind: 'textarea' } }),
seoImage: z.string().optional().meta({ ui: { kind: 'text' } }),
noindex: z.boolean().optional().meta({ ui: { kind: 'boolean' } }),
```

`noindex: true`, 404 routes, `?preview=1`, and
`?vulse-preview=<token>` all emit `noindex, nofollow`.

### Reusing the resolver

Custom adapters can reuse Vulse's head rules without using the built-in
Vue shell:

```ts
import { resolveHead } from '@vulse/site/server';

const head = resolveHead(state, siteConfig, new URL('https://example.com/posts/hello'));
```

The resolver returns a structured object with `title`, `meta`, `links`,
`scripts`, and `jsonLd`, so Astro/Nuxt/custom frontends can map the same
rules into their own head APIs later.

## 7. Script injection

Use `site.scripts` for analytics and tag-manager snippets. Scripts are
configured in code, not authored in content entries, so they stay
reviewable and easy to disable.

```ts
const site = {
  scripts: [
    {
      id: 'gtm-head',
      position: 'head',
      productionOnly: true,
      content: `
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
        'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer','GTM-XXXXXXX');
      `,
    },
    {
      id: 'gtm-noscript',
      position: 'bodyOpen',
      productionOnly: true,
      noscript:
        '<iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX" height="0" width="0" style="display:none;visibility:hidden"></iframe>',
    },
  ],
} satisfies SiteConfig;
```

Available positions:

- `head` inserts before the bundled stylesheet.
- `bodyOpen` inserts immediately after `<body>`.
- `bodyClose` inserts near the end of `<body>`, after the Vulse client
  entry.

Each script supports `src`, inline `content`, `attrs`, `noscript`, and
`productionOnly`.

## Planned features

These are still outside the current built-in frontend:

- A site-side `/login` route and `useAuth()` composable.
- Sitemap generation.
- Image optimisation.
- Theme scaffolding beyond the current starter structure.
