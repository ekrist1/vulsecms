# Frontend foundation

This document covers the developer-facing frontend features in
`@vulse/site`: site configuration, route overrides, SSR head rendering,
SEO field conventions, script injection, and reuse from custom frontend
adapters.

The goal is to give Vulse a production-ready frontend foundation without
turning it into a theme system. The built-in Vue SSR site provides
defaults, but the same metadata rules can be reused by Astro, Nuxt, or a
custom h3 frontend later.

## 1. Site config

Configure frontend behavior through the `site` key in `vulse.config.ts`.

```ts
import { fileURLToPath } from 'node:url';
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
  blueprintsDir: fileURLToPath(new URL('./blueprints/', import.meta.url)),
  database: { url: 'file:./dev.db' },
  site,
};
```

`site.url` should be the public canonical origin in production. It is
used to generate canonical URLs and convert relative image paths into
absolute OpenGraph/Twitter image URLs.

## 2. Route overrides

Put frontend route overrides under `site.routes`.

```ts
const site = {
  routes: {
    '/about': { collection: 'pages', slug: 'about' },
    '/blog': {
      collection: 'posts',
      list: true,
      filter: { status: { eq: 'published' } },
      sort: [{ field: 'publishedAt', direction: 'desc' }],
    },
  },
} satisfies SiteConfig;
```

The old top-level `routes` option still works for compatibility, but
`site.routes` wins when both define the same pathname.

## 3. SSR head rendering

The built-in SSR shell calls:

```ts
import { resolveHead } from '@vulse/site/server';

const head = resolveHead(state, siteConfig, new URL('https://example.com/posts/hello'));
```

`resolveHead()` returns a structured `ResolvedHead` object:

```ts
interface ResolvedHead {
  htmlAttrs: Record<string, string>;
  title: string;
  meta: Array<{ name?: string; property?: string; content: string }>;
  links: Array<{ rel: string; href: string }>;
  scripts: SiteScript[];
  jsonLd: unknown[];
}
```

`renderPage()` turns that object into server-rendered HTML. The default
shell emits:

- `<title>`
- `<meta name="description">`
- `<meta name="robots">`
- OpenGraph tags
- Twitter card tags
- `<link rel="canonical">`
- JSON-LD scripts
- configured analytics/scripts

Custom adapters can call `resolveHead()` directly and map the returned
object into their own framework head API.

## 4. SEO field conventions

Vulse reads SEO values from ordinary blueprint fields. There is no
special SEO field type.

| Purpose | Preferred field | Fallbacks |
| --- | --- | --- |
| Title | `seoTitle` | `seo_title`, `title`, `headline`, `site.defaultTitle`, `site.name` |
| Description | `seoDescription` | `seo_description`, `description`, `excerpt`, `site.defaultDescription` |
| Image | `seoImage` | `seo_image`, `ogImage`, `og_image`, `coverImage`, `cover_image`, `site.defaultImage` |
| Canonical URL | `canonicalUrl` | `canonical_url`, generated from `site.url + pathname` |
| Robots | `noindex` | route status, preview URL, `site.seo.robots` |
| JSON-LD | `jsonLd` | `json_ld`, `structuredData`, `structured_data` |

Example blueprint fields:

```ts
import { z } from 'zod';

export class PostsBlueprint {
  static handle = 'posts';
  static label = 'Posts';

  static schema = z.object({
    title: z.string().meta({ ui: { kind: 'text' } }),
    slug: z.string().meta({ ui: { kind: 'text' } }),
    excerpt: z.string().optional().meta({ ui: { kind: 'textarea' } }),
    seoTitle: z.string().optional().meta({ ui: { kind: 'text' } }),
    seoDescription: z.string().optional().meta({ ui: { kind: 'textarea' } }),
    seoImage: z.string().optional().meta({ ui: { kind: 'text' } }),
    noindex: z.boolean().optional().meta({ ui: { kind: 'boolean' } }),
    body: z.any().meta({ ui: { kind: 'blocks' } }),
  });
}
```

`noindex: true`, 404 routes, `?preview=1`, and
`?vulse-preview=<token>` emit `noindex, nofollow`.

## 5. JSON-LD

For structured data, store a JSON object or array on one of the JSON-LD
convention fields.

```ts
const articleJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'How Vulse renders content',
  datePublished: '2026-05-20',
};
```

If the entry contains `jsonLd: articleJsonLd`, SSR outputs it as:

```html
<script type="application/ld+json">...</script>
```

Keep JSON-LD deterministic. Avoid values like `Date.now()` during SSR,
because they can cause hydration or cache inconsistencies.

## 6. Script injection

Use `site.scripts` for analytics, tag managers, and other global
frontend scripts.

```ts
const site = {
  scripts: [
    {
      id: 'analytics',
      position: 'bodyClose',
      src: 'https://analytics.example.com/script.js',
      attrs: { async: true, defer: true },
      productionOnly: true,
    },
  ],
} satisfies SiteConfig;
```

Available positions:

- `head` inserts before the bundled stylesheet.
- `bodyOpen` inserts immediately after `<body>`.
- `bodyClose` inserts after the Vulse client entry.

Each script supports:

- `id`: required identifier, emitted as `data-vulse-script`.
- `position`: `head`, `bodyOpen`, or `bodyClose`.
- `src`: external script URL.
- `content`: inline script content.
- `attrs`: extra HTML attributes. Boolean `true` renders as a boolean
  attribute.
- `noscript`: HTML rendered inside a `<noscript>` tag.
- `productionOnly`: only render when `NODE_ENV === 'production'`.

Scripts are configured in code, not authored in content entries. This is
intentional: global scripts should be reviewable and easy to disable.

## 7. Google Tag Manager example

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

Replace `GTM-XXXXXXX` with the real container id.

## 8. Rendering manually

Most Vulse apps should use `createSiteServer()`, but lower-level rendering
is still available.

```ts
import { renderPage, resolveHead, resolveSiteRequest } from '@vulse/site/server';

const url = new URL('https://example.com/posts/hello');
const { status, state } = await resolveSiteRequest(deps, url);
const head = resolveHead(state, siteConfig, url);
const html = await renderPage(`${url.pathname}${url.search}`, state, {
  site: siteConfig,
  requestUrl: url,
});
```

`renderPage()` already calls `resolveHead()`. Calling it manually is useful
when you are building a custom adapter and need structured metadata.

## 9. Boundaries

Frontend foundation v1 deliberately does not include:

- A theme marketplace.
- Predefined content blocks.
- Image optimization.
- Sitemap generation.
- A built-in public `/login` route.
- Framework-specific adapters.

Those can be added later without changing the core content API.
