---
'@vulse/astro': minor
'@vulse/core': minor
'@vulse/auth': minor
'@vulse/db': minor
'@vulse/host': minor
'@vulse/image': minor
'@vulse/renderer': minor
'@vulse/admin': minor
---

Astro content loader + headless API improvements.

### New: `@vulse/astro`

A first-class Astro Content Layer loader. Drop it into
`src/content.config.ts` and Vulse collections sync into your Astro
project with incremental builds, content-hash digests, and preview-token
support. See [`packages/astro/README.md`](../packages/astro/README.md)
for the recipe.

```ts
import { defineCollection } from 'astro:content';
import { vulseLoader } from '@vulse/astro';

export const collections = {
  posts: defineCollection({
    loader: vulseLoader({ url: import.meta.env.VULSE_URL, collection: 'posts' }),
  }),
};
```

### Public API additions (`@vulse/core`)

- `GET /api/public/collections/:handle?since=<ISO-8601>` — returns only
  entries with `updated_at > since`. Powers incremental content loaders.
  The same parameter is also accepted by the admin list endpoint.
- Every entry response now includes `contentHash: string` — a 16-char
  SHA-256 prefix of the stored content JSON, stable for unchanged
  content. Loaders can use it as a digest for change detection.
- `GET /api/public/collections/:handle/:id?preview=<token>` — when a
  valid preview token is supplied (signed for that specific entry), the
  response returns the draft content. Without the token the public
  single-entry endpoint now strictly returns 404 for unpublished
  entries, matching the list endpoint.

### Breaking changes

- `GET /api/public/collections/:handle/:id` previously returned the
  entry regardless of `status`. It now returns 404 for unpublished
  entries unless a valid `?preview=<token>` is supplied. Frontends that
  relied on the loose behaviour need to either publish their content or
  pass a preview token. This brings the single-entry endpoint in line
  with the list endpoint, which already filtered by `status` by default.
- The `Entry` shape gained a required `contentHash: string` field. TypeScript
  consumers of `@vulse/core`'s `Entry` type may need to update fixtures.
