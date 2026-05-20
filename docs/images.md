# Images and optimization

Vulse ships on-the-fly image transformation via the `@vulse/image` package.
You reference an asset by id; the system delivers responsive, format-negotiated,
disk-cached variants over `/_vulse/img/*`.

## 1. Setup

`@vulse/image` is opt-in. In your host app:

```ts
import { imageRoutes, probeMetadata } from '@vulse/image';

// In createApi options:
probeImage: async (url) => {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return probeMetadata(buf);
},

// In the API app, imageRoutes is mounted automatically when imageSecret is set.
```

### Environment

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `VULSE_IMAGE_SECRET` | No | falls back to `VULSE_SESSION_SECRET` | HMAC signing secret. |
| `VULSE_IMAGE_CACHE_DIR` | No | `.vulse/cache/img` | Disk cache location. |

Configuration is currently via environment variables only — see the table above.

## 2. Using `<VulseImage>`

```vue
<script setup lang="ts">
import { VulseImage } from '@vulse/renderer';
import { useEntry } from '@vulse/site/composables';
const { entry } = useEntry();
</script>

<template>
  <VulseImage
    v-if="entry?.content.cover"
    :asset="entry.content.cover"
    :width="800"
    format="webp"
    sizes="(min-width: 768px) 50vw, 100vw"
    alt="Cover"
  />
</template>
```

### Props

| Prop      | Type                                       | Default              |
| --------- | ------------------------------------------ | -------------------- |
| `asset`   | `AssetDTO` (must include `id`)             | required             |
| `width`   | `number`                                   | `1200`               |
| `height`  | `number`                                   | derived from aspect  |
| `format`  | `'webp' \| 'avif' \| 'jpg' \| 'png' \| 'auto'` | `'auto'`         |
| `quality` | `number` (1-100)                           | `75`                 |
| `fit`     | `'cover' \| 'contain' \| 'inside' \| 'outside'` | `'cover'`       |
| `sizes`   | `string`                                   | none                 |
| `widths`  | `number[]`                                 | `[w/2, w, w*2]`      |
| `loading` | `'lazy' \| 'eager'`                        | `'lazy'`             |
| `alt`     | `string`                                   | required             |

The component reads `asset.imageWidth`/`imageHeight` and emits matching
`width`/`height` attributes on the `<img>` for CLS-safe rendering. If those
are absent, the attributes are omitted (better than wrong values).

### Worked examples

**Cover image:**
```vue
<VulseImage :asset="entry.cover" :width="1600" sizes="100vw" alt="Cover" />
```

**Responsive hero with art-directed widths:**
```vue
<VulseImage
  :asset="entry.hero"
  :width="1200"
  :widths="[400, 800, 1200, 1600, 2400]"
  sizes="(min-width: 1024px) 1200px, 100vw"
  alt="Hero"
/>
```

**Fixed thumbnail:**
```vue
<VulseImage :asset="row.cover" :width="120" :height="120" fit="cover" alt="" />
```

## 3. Renderer block (body content)

Editors can insert a `vulseImage` block in any rich-text field. Stored shape:

```json
{ "type": "vulseImage", "attrs": { "assetId": "01HF...", "alt": "...", "caption": "...", "sizes": "..." } }
```

To override the block's rendering, pass a custom component map to `BlockRenderer`.

## 4. Providers

v1 ships the `local` provider only — the in-process h3 server. To swap to a
platform CDN later, set `image.provider` in `vulse.config.ts` to a provider
object implementing `ImageProvider`:

```ts
interface ImageProvider {
  buildUrl(input: { assetId: string; mods: ImageModifiers; originalExt?: string }): string;
}
```

When a non-local provider is set, the local h3 routes are not mounted.

## 5. SEO / Open Graph images

Configure `site.resolveImage` in `vulse.config.ts` to convert asset
references into optimized 1200×630 URLs:

```ts
import { buildImageUrl } from '@vulse/image/url';

site: {
  resolveImage: (raw, site) => {
    if (raw && typeof raw === 'object' && 'id' in raw) {
      return (
        site.url +
        buildImageUrl({
          assetId: (raw as { id: string }).id,
          mods: { w: 1200, h: 630, f: 'jpg', fit: 'cover' },
          secret: process.env.VULSE_IMAGE_SECRET ?? process.env.VULSE_SESSION_SECRET ?? '',
        })
      );
    }
    return typeof raw === 'string' ? raw : undefined;
  },
},
```

## 6. Cache management

Transformed variants live under `.vulse/cache/img/<2-char-shard>/<sha256>.<ext>`.

- Clear: `node packages/image/dist/scripts/clear-cache.js` or `rm -rf .vulse/cache/img`.
- Sizing: a typical site of ~500 image assets × 3 widths × 1 format ≈ 50-200 MB.

## 7. Security

URLs are HMAC-signed; tampered URLs return 403. Width/height/quality have
hard server-side bounds; out-of-range values return 400 even with a valid
signature. Never expose `VULSE_IMAGE_SECRET` to client bundles — the admin
fetches signed thumbnail URLs via `GET /api/assets/:id/thumb-url`.

## 8. Backfill

For assets uploaded before this feature shipped (or where the probe failed),
run:

```bash
node packages/image/dist/scripts/backfill-metadata.js
```

Reads from the same `VULSE_DATABASE_URL` env vars the server uses.

## 9. Troubleshooting

- **sharp install fails on Alpine:** `apk add --no-cache vips-dev` then `pnpm install`.
- **403 on every image URL:** `VULSE_IMAGE_SECRET` doesn't match between
  process serving the page and process serving `/_vulse/img/*`. Make sure
  they share a value (or both fall back to the same `VULSE_SESSION_SECRET`).
- **Private S3 bucket:** the image server uses the same configured credentials
  to issue presigned GETs; nothing extra to set up.
- **OOM on large originals:** sharp streams, but very large originals
  (~50 MP+) need RAM. Consider rejecting uploads above a size limit at the
  asset registration step (separate spec).
