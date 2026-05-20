# Image optimization — design

Status: draft (approved by user 2026-05-20)
Owner: Vulse core
Related: assets feature, `@vulse/renderer`, `@vulse/site` head/SEO

## 1. Goal

Add on-the-fly image transformation and optimization to Vulse with strong
developer ergonomics, modeled on Statamic's Glide but using the JS-native
[IPX](https://github.com/unjs/ipx) library (which wraps sharp). Editors and
frontend developers reference assets by id; the system delivers responsive,
format-negotiated, cached image variants without anyone running a build step.

Non-goals for v1: AI features (smart crop / upscaling), background processing
workers, multi-instance shared caching, image editing UI inside the admin.

## 2. Constraints

- Vulse is Vue 3 + h3 SSR. The component must work in SSR with no
  `window`/`navigator` usage in render.
- Assets live in S3 today (public or private buckets), tracked in the `assets`
  table. The existing presign-upload-register flow stays unchanged except for
  one metadata-probe step added at registration.
- Sharp ships a ~30MB native binary; we cannot make every consumer of
  `@vulse/core` pay that cost.
- The system must run locally and on standard Node hosts (Fly, Railway, Docker,
  VPS) out of the box. Vercel/Netlify support is a provider concern, not a
  blocker for v1.

## 3. Architecture

### 3.1 New package: `@vulse/image`

Separate workspace package, opt-in by the host app (same pattern as how
`assetRoutes` is mounted today). Keeps `sharp` out of the default
`@vulse/core` dependency graph.

Exports:

- `imageRoutes(adapter, options)` — h3 sub-router serving `/_vulse/img/*`.
- `@vulse/image/url` — sharp-free entry exporting `buildImageUrl(asset, mods, secret)`
  and `parseImageUrl(path)`. Safe to import from the client bundle and from the
  admin SPA.
- `@vulse/image/provider` — provider interface for future Vercel/Netlify
  adapters; v1 ships only the `local` provider (the built-in IPX server).

Internal layout (proposed):

```
packages/image/
  src/
    index.ts                  // imageRoutes + re-exports
    routes.ts                 // h3 handler, sig check, allowlist, dispatch
    transform.ts              // sharp pipeline applied to a buffer
    cache.ts                  // disk cache: get, put, key
    dedupe.ts                 // in-process inflight map
    sign.ts                   // hmac sign/verify
    modifiers.ts              // parse/serialize modifier string, allowlist
    metadata.ts               // probe (width/height/blurhash) from buffer
    url.ts                    // isomorphic URL builder/parser
    provider/
      types.ts
      local.ts                // default provider; uses sign+modifiers+routes
    scripts/
      backfill-metadata.ts    // one-shot CLI to populate dims for old rows
  package.json
  tsconfig.json
```

Dependencies: `sharp`, `h3`, `@vulse/db` (for the backfill script only),
`@vulse/core` (peer, for `S3Config` and `AssetDTO` types).

### 3.2 Vue component lives in `@vulse/renderer`

`<VulseImage>` is colocated with other `Vulse*` blocks so it's available wherever
the renderer is. It imports only from `@vulse/image/url` (no sharp).

### 3.3 Renderer block for body content

A TipTap-shaped node `vulseImage` with attrs `{ assetId, alt, caption, sizes }`
gets registered in the existing block defaults map. Renders via the same
`<VulseImage>` component.

### 3.4 Provider abstraction

`imageRoutes` accepts `provider: 'local' | ProviderObject`. v1 ships only
`local`. The provider interface defines:

```ts
interface ImageProvider {
  buildUrl(asset: AssetDTO, mods: Modifiers): string;
  // If undefined, no local h3 routes are mounted (e.g. Vercel/Netlify).
  handler?: h3.EventHandler;
}
```

Future Vercel/Netlify providers swap the URL builder to platform-native URLs
and return no handler.

## 4. URL scheme and signing

### 4.1 Shape

```
/_vulse/img/<sig>/<modifiers>/<assetId>.<ext>
```

Examples:

- `/_vulse/img/aB7f2k/w_800,f_webp,q_75/01HFK3...jpg.webp`
- `/_vulse/img/c4Lx1q/w_1600,h_900,fit_cover/01HFK3...jpg.jpg`

The trailing `.<ext>` matches the output format so browsers and CDNs pick the
right MIME type and caching applies cleanly.

### 4.2 Modifiers (v1)

| Key   | Meaning                          | Type / range            |
| ----- | -------------------------------- | ----------------------- |
| `w`   | Output width (px)                | int 16..4096            |
| `h`   | Output height (px)               | int 16..4096            |
| `f`   | Output format                    | `webp` `avif` `jpg` `png` `auto` |
| `q`   | Quality                          | int 1..100              |
| `fit` | Resize mode                      | `cover` `contain` `inside` `outside` |
| `pos` | Gravity (for `cover`)            | `center` `top` `bottom` `left` `right` `attention` |

`f=auto` resolves server-side from the request `Accept` header
(avif → webp → fall back to the original's format).

Modifier strings are sorted (deterministic) and comma-separated. Unknown keys
return 400.

### 4.3 Signing

- `<sig> = base64url(hmac-sha256(secret, assetId + "|" + canonical_mods))[:8]`.
- Secret: `VULSE_IMAGE_SECRET`, falling back to `VULSE_SESSION_SECRET`
  (same fallback pattern as `previewSecret` in the dev app).
- Mismatch → 403. Out-of-range modifier with valid signature → 400.

### 4.4 Defense in depth

Signing alone is sufficient if the secret stays secret. The numeric and enum
allowlists exist so that a leaked signature cannot be weaponized into giant or
malformed transforms.

## 5. Data flow

### 5.1 Upload (existing flow, one addition)

1. Client → `POST /api/assets/sign` → presigned PUT URL.
2. Client → S3 (direct upload).
3. Client → `POST /api/assets` to register.
   - **New:** if `contentType` starts with `image/`, the handler fetches the
     object from S3 (using the same configured client), runs
     `sharp(buf).metadata()`, and stores `image_width`/`image_height`
     (and, if cheap, `image_blurhash`) on the row.
   - Probe failure (corrupt, unsupported codec) does not fail the request —
     the asset is created without dims; the component falls back.

### 5.2 Render

1. Component receives an `AssetDTO` (already has `assetId` and dimensions).
2. Sync URL builder generates `src` and `srcset` for the configured widths.
   No network call.
3. Browser requests `/_vulse/img/<sig>/<mods>/<assetId>.<ext>`.
4. `imageRoutes` handler:
   - Verify signature → parse and allowlist modifiers → look up cache key
     `sha256(assetId + "|" + canonical_mods)`.
   - On hit: stream `.vulse/cache/img/<key>.<ext>` with
     `ETag: "<key>"` and `Cache-Control: public, max-age=31536000, immutable`.
   - On miss: dedupe via inflight map; if first in, fetch original from S3,
     run sharp pipeline, write to a tmp file, `rename` to final path, stream
     response. Subsequent inflight callers await the same promise.

### 5.3 Eviction

v1: none. Operators clear by removing the cache directory (`rm -rf
.vulse/cache/img`). The implementation may ship a tiny
`packages/image/src/scripts/clear-cache.ts` wrapper, but no dedicated CLI is
required for v1. LRU can be added later if the cache grows unbounded in
practice.

## 6. Database changes

One migration in `@vulse/db`:

```sql
ALTER TABLE assets ADD COLUMN image_width INTEGER;
ALTER TABLE assets ADD COLUMN image_height INTEGER;
ALTER TABLE assets ADD COLUMN image_blurhash TEXT;
```

All nullable. `AssetDTO` and `rowToDTO` in
`packages/core/src/assets/service.ts` gain three optional fields:
`imageWidth?: number | null`, `imageHeight?: number | null`,
`imageBlurhash?: string | null`.

A backfill script
`packages/image/src/scripts/backfill-metadata.ts` iterates image-typed assets
where `image_width IS NULL`, probes them via S3, and updates rows. Documented
in `docs/images.md`; not run automatically.

## 7. Vue component API

```vue
<VulseImage
  :asset="entry.cover"
  :width="800"
  format="webp"
  quality="75"
  fit="cover"
  sizes="(min-width: 768px) 50vw, 100vw"
  alt="Cover"
/>
```

Renders to:

```html
<img
  src="/_vulse/img/<sig>/w_800,f_webp/01HF...jpg.webp"
  srcset="/_vulse/img/.../w_400,f_webp/... 400w,
          /_vulse/img/.../w_800,f_webp/... 800w,
          /_vulse/img/.../w_1600,f_webp/... 1600w"
  sizes="(min-width: 768px) 50vw, 100vw"
  width="800" height="533"
  loading="lazy" decoding="async"
  alt="Cover"
/>
```

Props (all optional except `asset`):

| Prop      | Type                              | Default                |
| --------- | --------------------------------- | ---------------------- |
| `asset`   | `AssetDTO \| string` (id)         | required               |
| `width`   | `number`                          | `1200`                 |
| `height`  | `number`                          | derived from aspect    |
| `format`  | `'webp'\|'avif'\|'jpg'\|'png'\|'auto'` | `'auto'`           |
| `quality` | `number`                          | `75`                   |
| `fit`     | `'cover'\|'contain'\|'inside'\|'outside'` | `'cover'`      |
| `sizes`   | `string`                          | none                   |
| `loading` | `'lazy'\|'eager'`                 | `'lazy'`               |
| `alt`     | `string`                          | required               |
| `widths`  | `number[]`                        | `[w*0.5, w, w*2]` (clamped) |

If `asset` is a string id, the component fetches `/api/assets/:id` once
(SWR-style). Preferred usage is passing the full `AssetDTO`.

If `imageWidth`/`imageHeight` are absent, the component omits `width`/`height`
attrs (better than emitting wrong ones).

## 8. Frontend changes

### 8.1 `@vulse/renderer`

- Add `src/components/VulseImage.vue` (the standalone component above).
- Add `src/blocks/VulseImage.vue` — TipTap-shaped node renderer.
- Register `vulseImage` in the existing block defaults map.
- Export `<VulseImage>` from the package entry so custom pages can import it
  directly.

### 8.2 `@vulse/site`

- `head.ts` currently resolves `seoImage` / `coverImage` and emits absolute
  URLs for `og:image`. **Change:** if the resolved value is (or can be looked
  up as) a Vulse asset, swap to a signed image URL at `1200×630, fit=cover,
  f=jpg`. Plain external URLs pass through unchanged.
- Test in `head.test.ts` updated to cover both branches.

### 8.3 `@vulse/admin`

- `pages/AssetList.vue` and `components/fields/AssetField.vue` currently use
  the raw `asset.url` for thumbnails. With private S3 buckets that doesn't
  load at all; with public buckets it ships full-resolution originals into
  the picker.
- **Change:** swap thumbnail `<img>` tags to use signed URLs.
  - Admin must not know the HMAC secret (the SPA bundle is shipped to the
    browser). Solution: `imageRoutes` exposes
    `GET /api/assets/:id/thumb-url?w=240` (mounted by `@vulse/image`, not
    `@vulse/core`, so the signer stays colocated with the secret). The
    endpoint requires an authenticated session and returns `{ url }`. Admin
    caches per-asset.
  - Alternative considered: ship a short-lived signing token to authenticated
    admins. Rejected for v1 — extra moving part for marginal benefit.

### 8.4 `apps/dev` (host app)

- Mount `imageRoutes(adapter, { secret, cacheDir, provider: 'local' })` in
  `buildListeners` alongside `assetRoutes`.
- In `server.prod.ts`, the `/_vulse/img/*` path needs to route to the API
  listener (which now owns it), not the static handler. Today `/_vulse/site/`
  is the only `/_vulse/*` prefix served statically; we add an explicit
  `req.url.startsWith('/_vulse/img/')` branch to the API path.

## 9. Configuration

Added to `vulse.config.ts` (all optional with sensible defaults):

```ts
export default {
  // ...existing config...
  image: {
    provider: 'local',           // future: 'vercel' | 'netlify' | custom
    cacheDir: '.vulse/cache/img',
    maxWidth: 4096,
    maxHeight: 4096,
    allowedFormats: ['webp', 'avif', 'jpg', 'png'],
    defaultQuality: 75,
  },
};
```

Environment:

| Var | Required | Default | Notes |
| --- | --- | --- | --- |
| `VULSE_IMAGE_SECRET` | No | falls back to `VULSE_SESSION_SECRET` | HMAC signing secret. |

## 10. Developer documentation (`docs/images.md`)

Implementation must ship a new `docs/images.md` covering:

1. **Setup** — install `@vulse/image`, mount `imageRoutes`, env vars,
   `vulse.config.ts` options.
2. **Using `<VulseImage>`** — full prop reference, three worked examples
   (cover image / responsive hero / fixed thumbnail).
3. **Renderer block** — how the `vulseImage` body block stores data, how to
   insert it from a custom TipTap toolbar, how to override its rendering.
4. **Providers** — `local` default, the provider interface, escape hatch for
   future Vercel/Netlify adapters.
5. **OG / social images** — automatic 1200×630 optimization for `seoImage`,
   how to override.
6. **Cache management** — location, sizing expectations, manual clear.
7. **Security model** — signing, allowlists, why raw S3 URLs are discouraged
   for public sites.
8. **Backfill** — running `backfill-metadata` for assets uploaded before this
   feature shipped.
9. **Troubleshooting** — `sharp` install issues on Alpine, missing libvips,
   private bucket gotchas, dev vs prod parity.

## 11. Testing

| Layer | Tests |
| ----- | ----- |
| `@vulse/image` unit | URL builder round-trip, HMAC sign/verify, modifier parser, allowlist enforcement, format-auto negotiation from `Accept`. |
| `@vulse/image` integration | Real sharp pipeline against fixture image: dimensions match, cache hit/miss behavior, inflight dedupe, 403 on bad sig, 400 on out-of-range modifier. |
| `@vulse/core` assets | Asset registration probes dims for `image/*` content types; non-image rows still pass; probe failure does not fail registration. |
| `@vulse/renderer` | Snapshot of generated `<img>` markup; SSR render without `window`. |
| `@vulse/site` head | `og:image` becomes a signed image URL when `seoImage` resolves to a Vulse asset; external URL passes through. |
| `@vulse/admin` | Thumbnails request signed URL endpoint; endpoint returns 200 and a parseable URL. |

All under the existing root `vitest` workspace.

## 12. Rollout

1. Land migration + `image_*` columns on `assets`; ship asset registration
   probe.
2. Land `@vulse/image` package (transform pipeline, signing, cache, local
   provider, URL builder).
3. Land `<VulseImage>` component and the renderer block.
4. Update `head.ts` to optimize OG images.
5. Update admin thumbnails to use signed URLs.
6. Mount `imageRoutes` in `apps/dev`; update prod server routing.
7. Ship `docs/images.md` and backfill script.

Each step is independently deployable: assets keep working with raw S3 URLs
throughout, and `<VulseImage>` degrades gracefully on assets without dims.

## 13. Future work (explicit non-goals for v1)

- Vercel and Netlify provider adapters.
- LRU eviction / cache size limits.
- Smart crop, focal-point UI in admin.
- Blurhash placeholder rendering in `<VulseImage>` (column is reserved; renderer
  use is deferred).
- Background processing queue for large-batch reprocessing.
- Multi-instance shared cache (S3-backed cache provider).
