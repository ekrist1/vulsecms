# @vulse/astro

[Astro Content Layer](https://docs.astro.build/en/guides/content-collections/)
loader for [Vulse](https://github.com/ekrist1/vulsecms) — a headless,
TypeScript-first CMS. Syncs collections, drafts, and previews into your
Astro project with incremental builds.

```sh
pnpm add @vulse/astro
```

## Usage

```ts
// src/content.config.ts
import { defineCollection } from 'astro:content';
import { vulseLoader } from '@vulse/astro';

const VULSE_URL = import.meta.env.VULSE_URL ?? 'http://localhost:3000';

export const collections = {
  posts: defineCollection({
    loader: vulseLoader({ url: VULSE_URL, collection: 'posts' }),
    // Optional. If omitted, the loader fetches the collection's blueprint
    // and builds a Zod schema from it (text/textarea/date/boolean/select
    // fields are typed; blocks/asset/relationship fall through as
    // `z.unknown()`).
    // schema: z.object({ title: z.string(), slug: z.string() }),
  }),
};
```

Then in any page:

```astro
---
import { getCollection } from 'astro:content';
const posts = await getCollection('posts');
---
{posts.map((post) => (
  <article>
    <h2>{post.data.title}</h2>
    <a href={`/posts/${post.data.slug}`}>Read</a>
  </article>
))}
```

## Incremental sync

The loader stores the highest `updatedAt` it has seen in Astro's meta
store. On the next run it passes `?since=<timestamp>` to Vulse and only
refetches entries updated since the last build. The `digest` it writes
into the store is Vulse's `contentHash`, so unchanged entries are
detected as unchanged.

## Previewing draft content

To render unpublished content in a preview deployment:

1. Generate a preview token from your admin:
   ```sh
   curl -X POST -H "cookie: …" \
     http://localhost:3000/api/collections/posts/<entry-id>/preview-token
   # → { "token": "vp_…", "expiresAt": "…" }
   ```
2. Pass the token to the loader:
   ```ts
   vulseLoader({
     url: VULSE_URL,
     collection: 'posts',
     preview: { token: process.env.VULSE_PREVIEW_TOKEN!, entryId: 'XYZ' },
   });
   ```

The loader runs the normal published sync, then overlays the draft
content for the specified entry on top of the store. If the token is
invalid or expired, the loader logs a warning and continues with the
published view.

## Options

```ts
vulseLoader({
  url: string;            // Vulse server base URL
  collection: string;     // Vulse collection handle
  preview?: { token: string; entryId: string };
  pageSize?: number;      // 1–500, default 200
  fetch?: typeof fetch;   // override (tests only)
});
```

## Requirements

- Vulse server **v0.2.0 or newer** (the `?since=` filter and `contentHash`
  on entries arrived in that release).
- Astro v4.14+ or v5.x.

## Rendering Vulse block content

If your blueprint uses the `blocks` field kind, the entry's `body` field
is a structured JSON document. Render it with `@vulse/renderer`'s
`<BlockRenderer>` component (Vue), or walk the tree yourself. See
[docs/frontend-foundation.md](https://github.com/ekrist1/vulsecms/blob/main/docs/frontend-foundation.md)
in the main repo.
