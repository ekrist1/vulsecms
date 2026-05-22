# Connecting a frontend

Vulse is a **headless CMS**. The Vulse server ships the admin SPA and an
HTTP API; the public-facing site lives in a separate frontend project of
your choice (Astro, Next, SvelteKit, Nuxt, Remix, plain HTML, anything
that can `fetch`). This document covers the contract your frontend uses
and walks through the Astro recipe as the worked example.

> The dedicated `@vulse/astro` content loader is on the roadmap (see the
> Workstream B plan). Until it ships, integrate via `fetch` — it's a
> handful of lines.

---

## 1. The public API surface

All endpoints below are public (no cookie required) and return JSON.
They are mounted under the API prefix you've configured (`/api/` by
default).

| Endpoint                                       | Returns                                         |
| ---------------------------------------------- | ----------------------------------------------- |
| `GET /api/public/collections/:handle`          | Paginated list of published entries             |
| `GET /api/public/collections/:handle/:id`      | A single published entry                        |
| `GET /api/public/collections/:handle/tree`     | Nested tree of entries (tree-enabled types)     |
| `GET /api/public/globals`                      | All public Globals                              |
| `GET /api/public/globals/:handle`              | One Global Set's value                          |
| `GET /api/public/_meta/collections`            | Schema metadata for every collection            |
| `GET /api/blueprints/:handle`                  | The full blueprint (schema) for one collection  |
| `GET /_vulse/img/<sig>/<modifiers>/<id>.<ext>` | Signed, on-the-fly transformed image            |

Common list query parameters:

| Param                     | Notes                                                  |
| ------------------------- | ------------------------------------------------------ |
| `limit`                   | 1–500, default 25                                      |
| `offset`                  | zero-based, for pagination                             |
| `q`                       | full-text search across searchable fields              |
| `field`                   | restrict text search to one field                      |
| `parent_id`               | tree collections — children of a parent (or `null`)    |
| `sort` / `-sort`          | `sort=updatedAt` ascending, `sort=-updatedAt` desc     |
| `filter[name][op]=value`  | `eq`, `neq`, `in`, `gt`, `gte`, `lt`, `lte`            |

Entries are returned with this shape:

```ts
type Entry = {
  id: string;
  collection: string;
  parentId: string | null;
  sortOrder: number;
  status: 'draft' | 'published';
  protected: boolean;
  content: Record<string, unknown>; // validated against the blueprint
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

By default, the public API returns only `status === 'published'` entries
and never returns protected entries. Drafts are reachable via admin auth
or a preview token (see [drafts.md](./drafts.md)).

---

## 2. Astro recipe

The smallest possible Astro integration uses Astro's
[Content Layer API](https://docs.astro.build/en/guides/content-collections/).
The loader is ~20 lines of `fetch`.

`src/content.config.ts`:

```ts
import { defineCollection, z } from 'astro:content';

const VULSE_URL = import.meta.env.VULSE_URL ?? 'http://localhost:3000';

export const collections = {
  posts: defineCollection({
    loader: {
      name: 'vulse:posts',
      async load({ store, parseData }) {
        const res = await fetch(`${VULSE_URL}/api/public/collections/posts?limit=500`);
        if (!res.ok) throw new Error(`Vulse responded ${res.status}`);
        const body = (await res.json()) as {
          items: { id: string; updatedAt: string; content: Record<string, unknown> }[];
        };
        store.clear();
        for (const item of body.items) {
          const data = await parseData({ id: item.id, data: item.content });
          store.set({
            id: item.id,
            data,
            digest: item.updatedAt,
          });
        }
      },
    },
    schema: z.object({
      title: z.string(),
      slug: z.string(),
      body: z.unknown(),
    }),
  }),
};
```

Use it in a page:

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

This loader will be replaced by the `@vulse/astro` package (incremental
sync, blueprint-derived schemas, preview-token support, image helpers)
when it ships.

---

## 3. Rendering Vulse block content

If you're on Vue (Astro can host Vue components), you can import the
`<BlockRenderer>` and `<VulseImage>` components from `@vulse/renderer`
to render Vulse block content directly:

```vue
<script setup lang="ts">
import { BlockRenderer } from '@vulse/renderer';
defineProps<{ body: unknown }>();
</script>

<template>
  <BlockRenderer :node="body" />
</template>
```

For non-Vue frontends, render the block tree yourself — the JSON shape is
documented in the blueprint metadata (`GET /api/blueprints/:handle`).

---

## 4. Images

Vulse delivers on-the-fly transformed images over `/_vulse/img/*`. URLs
are HMAC-signed; never construct them by hand from a frontend that
doesn't have the signing secret. Two options:

- **Vue frontends:** use `<VulseImage>` from `@vulse/renderer`, which
  signs the URL client-side using the image secret threaded into the page
  data by Vulse.
- **Non-Vue frontends:** ask the Vulse API for an already-signed asset
  URL (use the asset DTO that comes back inside an entry's `content`),
  or import the sub-entry `@vulse/image/url` (Sharp-free, safe at build
  time) and sign URLs server-side in your frontend's build step using
  `VULSE_IMAGE_SECRET`.

See [images.md](./images.md) for the modifier vocabulary (`w-`, `h-`,
`q-`, `f-…`).

---

## 5. Preview / drafts

To render unpublished content in a preview deployment of your frontend:

1. From the admin, generate a preview token for an entry via
   `POST /api/collections/:handle/:id/preview-token`. The response
   contains `{ token, expiresAt }` (default 15-minute lifetime).
2. In your frontend's preview environment, attach
   `?preview=<token>` (or a header — match what your loader expects) to
   the read request. The Vulse server validates the token and serves the
   draft content for that one entry.

See [drafts.md](./drafts.md) for the full draft/publish state machine.

---

## 6. CORS

The Vulse API does not set permissive CORS by default. If your frontend
runs on a different origin from the Vulse server, configure CORS at your
reverse proxy / edge layer, or run both behind the same hostname. A
built-in CORS option in `@vulse/host` is on the roadmap.

---

## 7. Environment variables your frontend needs

| Var                  | Purpose                                                      |
| -------------------- | ------------------------------------------------------------ |
| `VULSE_URL`          | Base URL of the Vulse server (e.g. `http://localhost:3000`)  |
| `VULSE_IMAGE_SECRET` | Only needed if you sign image URLs in your frontend's build  |
| `VULSE_PREVIEW_URL`  | Optional. Where the admin "Preview" button points            |

The Vulse server itself reads `VULSE_DB_URL`, `VULSE_AUTH_SECRET`, etc.
(See `docs/upgrading.md` and the host config docs.)
