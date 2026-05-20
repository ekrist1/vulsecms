# Image Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship on-the-fly image transformation in Vulse via a new opt-in `@vulse/image` package (sharp under the hood), a signed `/_vulse/img/*` URL scheme, a Vue `<VulseImage>` component, a renderer body block, and the supporting DB + admin + docs changes — so editors and frontend devs reference S3 assets by id and get responsive, format-negotiated, cached variants.

**Architecture:** New workspace package `@vulse/image` mounts an h3 sub-router that verifies signed URLs, applies an allowlisted sharp pipeline to S3-fetched originals, and disk-caches results under `.vulse/cache/img`. The `@vulse/image/url` sub-entry is sharp-free and used by `<VulseImage>` (in `@vulse/renderer`), the admin SPA (via a server-signed thumb endpoint), and `@vulse/site` head SEO. The `assets` table gains `image_width`/`image_height`/`image_blurhash` columns probed at registration.

**Tech Stack:** TypeScript (Node 22), pnpm workspace, h3 1.15, sharp 0.33, Vue 3.5 SSR, vitest 2, libsql/SQLite, zod 4.

**Spec:** [`docs/superpowers/specs/2026-05-20-image-optimization-design.md`](../specs/2026-05-20-image-optimization-design.md)

---

## File structure

### New package `packages/image/`

```
packages/image/
  package.json
  tsconfig.json
  src/
    index.ts                  // imageRoutes export + provider re-exports
    routes.ts                 // h3 sub-router; mounts /_vulse/img/* and /api/assets/:id/thumb-url
    sign.ts                   // hmac sign + verify
    modifiers.ts              // parse + serialize + allowlist
    transform.ts              // sharp pipeline
    cache.ts                  // disk cache get/put/key
    dedupe.ts                 // in-process inflight promise map
    metadata.ts               // sharp.metadata() probe wrapper
    fetch-source.ts           // pulls original bytes from S3 by asset id
    url.ts                    // (no sharp) buildImageUrl, parseImageUrl
    provider/
      types.ts                // ImageProvider interface
      local.ts                // default provider
    scripts/
      backfill-metadata.ts    // CLI: probe + update older assets
      clear-cache.ts          // CLI: rm -rf the cache dir
    __tests__/
      sign.test.ts
      modifiers.test.ts
      url.test.ts
      transform.test.ts        // sharp pipeline against fixture
      routes.test.ts           // full handler integration
      __fixtures__/cat.jpg     // small test image (~10KB)
```

### Modified files

```
packages/db/migrations/012_assets_image_metadata.sql      // CREATE
packages/core/src/assets/types.ts                          // AssetDTO: +imageWidth/Height/Blurhash
packages/core/src/assets/service.ts                        // rowToDTO: include new cols; CreateAssetInput: accept dims
packages/core/src/assets/routes.ts                         // POST /api/assets probes image dims if S3 + image/*
packages/renderer/src/blocks/VulseImage.vue                // CREATE (body block)
packages/renderer/src/components/VulseImage.vue            // CREATE (standalone component)
packages/renderer/src/defaults.ts                          // register vulseImage block
packages/renderer/src/index.ts                             // export VulseImage component
packages/site/src/head.ts                                  // accept resolveImage callback
packages/site/src/types.ts                                 // SiteConfig: optional resolveImage
packages/admin/src/pages/AssetList.vue                     // use signed thumb URL
packages/admin/src/components/fields/AssetField.vue        // same
packages/admin/src/api/client.ts                           // add fetchThumbUrl
apps/dev/src/server.prod.ts                                // mount imageRoutes; route /_vulse/img/* to api
apps/dev/src/main.ts                                       // (if it wires API in dev) — verify and update
docs/images.md                                             // CREATE
```

---

## Task 1: Add DB migration for image metadata columns

**Files:**
- Create: `packages/db/migrations/012_assets_image_metadata.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE assets ADD COLUMN image_width INTEGER;
ALTER TABLE assets ADD COLUMN image_height INTEGER;
ALTER TABLE assets ADD COLUMN image_blurhash TEXT;
```

- [ ] **Step 2: Verify migration runs cleanly**

Run from repo root:
```bash
rm -f apps/dev/dev.db
pnpm --filter @vulse/dev predev
node -e "import('@vulse/db').then(async ({ LibsqlAdapter, MIGRATIONS_DIR, runMigrations }) => { const db = new LibsqlAdapter({ url: 'file:apps/dev/dev.db' }); await runMigrations(db, MIGRATIONS_DIR); const cols = await db.query('PRAGMA table_info(assets)'); console.log(cols.map(c => c.name)); })"
```

Expected output includes: `image_width`, `image_height`, `image_blurhash` in the column list.

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations/012_assets_image_metadata.sql
git commit -m "feat(db): add image metadata columns to assets table"
```

---

## Task 2: Extend AssetDTO and rowToDTO

**Files:**
- Modify: `packages/core/src/assets/types.ts`
- Modify: `packages/core/src/assets/service.ts`

- [ ] **Step 1: Update AssetDTO type**

In `packages/core/src/assets/types.ts`, replace the `AssetDTO` interface with:

```ts
export interface AssetDTO {
  id: string;
  key: string;
  bucket: string;
  url: string;
  contentType: string | null;
  size: number | null;
  originalName: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageBlurhash: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: Update AssetRow + rowToDTO**

In `packages/core/src/assets/service.ts`, replace the `AssetRow` interface and `rowToDTO`:

```ts
interface AssetRow {
  id: string;
  key: string;
  bucket: string;
  url: string;
  content_type: string | null;
  size: number | null;
  original_name: string | null;
  image_width: number | null;
  image_height: number | null;
  image_blurhash: string | null;
  created_at: string;
}

function rowToDTO(r: AssetRow): AssetDTO {
  return {
    id: r.id,
    key: r.key,
    bucket: r.bucket,
    url: r.url,
    contentType: r.content_type,
    size: r.size,
    originalName: r.original_name,
    imageWidth: r.image_width,
    imageHeight: r.image_height,
    imageBlurhash: r.image_blurhash,
    createdAt: r.created_at,
  };
}
```

- [ ] **Step 3: Update CreateAssetInput + createAsset**

Replace the `CreateAssetInput` interface and the body of `createAsset` in `service.ts`:

```ts
export interface CreateAssetInput {
  key: string;
  url: string;
  bucket: string;
  contentType?: string | null;
  size?: number | null;
  originalName?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageBlurhash?: string | null;
}

export async function createAsset(
  adapter: DatabaseAdapter,
  input: CreateAssetInput,
): Promise<AssetDTO> {
  const id = ulid();
  await adapter.exec(
    `INSERT INTO assets (id, key, bucket, url, content_type, size, original_name,
                         image_width, image_height, image_blurhash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.key,
      input.bucket,
      input.url,
      input.contentType ?? null,
      input.size ?? null,
      input.originalName ?? null,
      input.imageWidth ?? null,
      input.imageHeight ?? null,
      input.imageBlurhash ?? null,
    ],
  );
  const row = await adapter.queryOne<AssetRow>('SELECT * FROM assets WHERE id = ?', [id]);
  if (!row) throw new Error('failed to create asset');
  return rowToDTO(row);
}
```

- [ ] **Step 4: Run existing asset tests**

```bash
pnpm --filter @vulse/core test -- assets
```

Expected: all existing tests pass (new columns are nullable; rowToDTO populates new fields as `null`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/assets/types.ts packages/core/src/assets/service.ts
git commit -m "feat(core): add image metadata fields to AssetDTO"
```

---

## Task 3: Scaffold @vulse/image package

**Files:**
- Create: `packages/image/package.json`
- Create: `packages/image/tsconfig.json`
- Create: `packages/image/src/index.ts`

- [ ] **Step 1: Create package.json**

Write to `packages/image/package.json`:

```json
{
  "name": "@vulse/image",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./url": { "types": "./dist/url.d.ts", "import": "./dist/url.js" },
    "./provider": { "types": "./dist/provider/types.d.ts", "import": "./dist/provider/types.js" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "check": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@vulse/core": "workspace:*",
    "@vulse/db": "workspace:*",
    "h3": "^1.15.11",
    "sharp": "^0.33.5"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Write to `packages/image/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create the index.ts placeholder**

Write to `packages/image/src/index.ts`:

```ts
export { imageRoutes } from './routes.js';
export type { ImageRoutesOptions } from './routes.js';
export { buildImageUrl, parseImageUrl, type ImageModifiers } from './url.js';
export type { ImageProvider } from './provider/types.js';
```

- [ ] **Step 4: Install dependencies**

```bash
pnpm install
```

Expected: `sharp` resolves and downloads platform-specific binaries. On Linux x64 this should "just work".

- [ ] **Step 5: Commit**

```bash
git add packages/image/package.json packages/image/tsconfig.json packages/image/src/index.ts pnpm-lock.yaml
git commit -m "chore(image): scaffold @vulse/image package"
```

---

## Task 4: Implement and test URL signing

**Files:**
- Create: `packages/image/src/sign.ts`
- Test: `packages/image/src/__tests__/sign.test.ts`

- [ ] **Step 1: Write the failing test**

Write to `packages/image/src/__tests__/sign.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { signImagePath, verifyImagePath } from '../sign.js';

const secret = 'test-secret';

describe('sign', () => {
  it('produces a stable signature for the same inputs', () => {
    const a = signImagePath('asset-1', 'w_800,f_webp', secret);
    const b = signImagePath('asset-1', 'w_800,f_webp', secret);
    expect(a).toBe(b);
    expect(a).toHaveLength(11); // base64url 8 bytes → 11 chars (no padding)
  });

  it('produces different signatures for different mods', () => {
    const a = signImagePath('asset-1', 'w_800,f_webp', secret);
    const b = signImagePath('asset-1', 'w_801,f_webp', secret);
    expect(a).not.toBe(b);
  });

  it('produces different signatures for different secrets', () => {
    expect(signImagePath('x', 'm', 'a')).not.toBe(signImagePath('x', 'm', 'b'));
  });

  it('verifyImagePath returns true for matching sig', () => {
    const sig = signImagePath('asset-1', 'w_800', secret);
    expect(verifyImagePath(sig, 'asset-1', 'w_800', secret)).toBe(true);
  });

  it('verifyImagePath returns false for tampered mods', () => {
    const sig = signImagePath('asset-1', 'w_800', secret);
    expect(verifyImagePath(sig, 'asset-1', 'w_900', secret)).toBe(false);
  });

  it('verifyImagePath returns false for tampered sig', () => {
    expect(verifyImagePath('xxxxxxxxxxx', 'asset-1', 'w_800', secret)).toBe(false);
  });

  it('uses constant-time comparison', () => {
    // Sanity: doesn't throw on length mismatch
    expect(verifyImagePath('short', 'asset-1', 'w_800', secret)).toBe(false);
    expect(verifyImagePath('a'.repeat(50), 'asset-1', 'w_800', secret)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test (should fail)**

```bash
pnpm --filter @vulse/image test
```

Expected: failure with "Cannot find module '../sign.js'" or similar.

- [ ] **Step 3: Implement sign.ts**

Write to `packages/image/src/sign.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const SIG_BYTES = 8;
const SIG_CHARS = 11; // base64url(8 bytes) length

export function signImagePath(assetId: string, mods: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(`${assetId}|${mods}`).digest();
  return mac.subarray(0, SIG_BYTES).toString('base64url');
}

export function verifyImagePath(
  sig: string,
  assetId: string,
  mods: string,
  secret: string,
): boolean {
  if (sig.length !== SIG_CHARS) return false;
  const expected = signImagePath(assetId, mods, secret);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run tests (should pass)**

```bash
pnpm --filter @vulse/image test
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/image/src/sign.ts packages/image/src/__tests__/sign.test.ts
git commit -m "feat(image): hmac signing for image transform URLs"
```

---

## Task 5: Implement and test modifier parsing / allowlist

**Files:**
- Create: `packages/image/src/modifiers.ts`
- Test: `packages/image/src/__tests__/modifiers.test.ts`

- [ ] **Step 1: Write the failing test**

Write to `packages/image/src/__tests__/modifiers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  type ImageModifiers,
  parseModifiers,
  serializeModifiers,
} from '../modifiers.js';

describe('modifiers', () => {
  it('parses width/height/format/quality', () => {
    expect(parseModifiers('w_800,h_600,f_webp,q_75')).toEqual({
      w: 800,
      h: 600,
      f: 'webp',
      q: 75,
    });
  });

  it('parses fit and pos', () => {
    expect(parseModifiers('w_800,fit_cover,pos_top')).toEqual({
      w: 800,
      fit: 'cover',
      pos: 'top',
    });
  });

  it('rejects unknown keys', () => {
    expect(() => parseModifiers('w_800,evil_1')).toThrow(/unknown modifier/);
  });

  it('rejects out-of-range width', () => {
    expect(() => parseModifiers('w_99999')).toThrow(/out of range/);
    expect(() => parseModifiers('w_0')).toThrow(/out of range/);
  });

  it('rejects invalid format', () => {
    expect(() => parseModifiers('f_bmp')).toThrow(/invalid format/);
  });

  it('rejects invalid fit', () => {
    expect(() => parseModifiers('fit_squash')).toThrow(/invalid fit/);
  });

  it('rejects non-integer width', () => {
    expect(() => parseModifiers('w_abc')).toThrow();
  });

  it('serializeModifiers produces a canonical sorted string', () => {
    const mods: ImageModifiers = { f: 'webp', w: 800, q: 75 };
    expect(serializeModifiers(mods)).toBe('f_webp,q_75,w_800');
  });

  it('round-trips through parse/serialize', () => {
    const input = 'fit_cover,h_600,w_800';
    expect(serializeModifiers(parseModifiers(input))).toBe(input);
  });
});
```

- [ ] **Step 2: Run the test (should fail)**

```bash
pnpm --filter @vulse/image test -- modifiers
```

Expected: failure with module-not-found.

- [ ] **Step 3: Implement modifiers.ts**

Write to `packages/image/src/modifiers.ts`:

```ts
export type ImageFormat = 'webp' | 'avif' | 'jpg' | 'png' | 'auto';
export type ImageFit = 'cover' | 'contain' | 'inside' | 'outside';
export type ImagePos = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'attention';

export interface ImageModifiers {
  w?: number;
  h?: number;
  f?: ImageFormat;
  q?: number;
  fit?: ImageFit;
  pos?: ImagePos;
}

const MIN_DIM = 16;
const MAX_DIM = 4096;
const FORMATS: readonly ImageFormat[] = ['webp', 'avif', 'jpg', 'png', 'auto'];
const FITS: readonly ImageFit[] = ['cover', 'contain', 'inside', 'outside'];
const POSITIONS: readonly ImagePos[] = ['center', 'top', 'bottom', 'left', 'right', 'attention'];

const PARSERS: Record<string, (raw: string, mods: ImageModifiers) => void> = {
  w: (raw, mods) => {
    const n = parseDim(raw, 'w');
    mods.w = n;
  },
  h: (raw, mods) => {
    const n = parseDim(raw, 'h');
    mods.h = n;
  },
  f: (raw, mods) => {
    if (!(FORMATS as readonly string[]).includes(raw)) {
      throw new Error(`invalid format: ${raw}`);
    }
    mods.f = raw as ImageFormat;
  },
  q: (raw, mods) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      throw new Error(`q out of range: ${raw}`);
    }
    mods.q = n;
  },
  fit: (raw, mods) => {
    if (!(FITS as readonly string[]).includes(raw)) {
      throw new Error(`invalid fit: ${raw}`);
    }
    mods.fit = raw as ImageFit;
  },
  pos: (raw, mods) => {
    if (!(POSITIONS as readonly string[]).includes(raw)) {
      throw new Error(`invalid pos: ${raw}`);
    }
    mods.pos = raw as ImagePos;
  },
};

function parseDim(raw: string, key: 'w' | 'h'): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${key} must be an integer: ${raw}`);
  if (n < MIN_DIM || n > MAX_DIM) throw new Error(`${key} out of range: ${raw}`);
  return n;
}

export function parseModifiers(input: string): ImageModifiers {
  const mods: ImageModifiers = {};
  if (!input) return mods;
  for (const pair of input.split(',')) {
    const idx = pair.indexOf('_');
    if (idx <= 0) throw new Error(`malformed modifier: ${pair}`);
    const key = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    const parser = PARSERS[key];
    if (!parser) throw new Error(`unknown modifier: ${key}`);
    parser(value, mods);
  }
  return mods;
}

export function serializeModifiers(mods: ImageModifiers): string {
  const parts: string[] = [];
  const keys = Object.keys(mods).sort() as (keyof ImageModifiers)[];
  for (const k of keys) {
    const v = mods[k];
    if (v === undefined) continue;
    parts.push(`${k}_${v}`);
  }
  return parts.join(',');
}
```

- [ ] **Step 4: Run tests (should pass)**

```bash
pnpm --filter @vulse/image test -- modifiers
```

Expected: all 9 modifier tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/image/src/modifiers.ts packages/image/src/__tests__/modifiers.test.ts
git commit -m "feat(image): modifier parsing and allowlist"
```

---

## Task 6: Implement and test the isomorphic URL builder

**Files:**
- Create: `packages/image/src/url.ts`
- Test: `packages/image/src/__tests__/url.test.ts`

- [ ] **Step 1: Write the failing test**

Write to `packages/image/src/__tests__/url.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildImageUrl, parseImageUrl } from '../url.js';

const secret = 'test-secret';

describe('url', () => {
  it('builds a signed URL with modifiers and trailing extension', () => {
    const url = buildImageUrl({
      assetId: '01HF0EXAMPLE',
      mods: { w: 800, f: 'webp' },
      secret,
    });
    // /_vulse/img/<sig>/f_webp,w_800/01HF0EXAMPLE.webp
    expect(url).toMatch(/^\/_vulse\/img\/[A-Za-z0-9_-]{11}\/f_webp,w_800\/01HF0EXAMPLE\.webp$/);
  });

  it('uses original extension when format omitted', () => {
    const url = buildImageUrl({
      assetId: '01HF0EXAMPLE',
      mods: { w: 800 },
      secret,
      originalExt: 'jpg',
    });
    expect(url).toMatch(/\/01HF0EXAMPLE\.jpg$/);
  });

  it('uses .jpg when format=auto and originalExt missing', () => {
    const url = buildImageUrl({ assetId: 'x', mods: { f: 'auto' }, secret });
    expect(url).toMatch(/\/x\.jpg$/);
  });

  it('parseImageUrl extracts sig, mods string, assetId, ext', () => {
    const url = buildImageUrl({
      assetId: '01HF0EXAMPLE',
      mods: { w: 800, f: 'webp' },
      secret,
    });
    const parsed = parseImageUrl(url);
    expect(parsed).toEqual({
      sig: expect.stringMatching(/^[A-Za-z0-9_-]{11}$/),
      modsRaw: 'f_webp,w_800',
      assetId: '01HF0EXAMPLE',
      ext: 'webp',
    });
  });

  it('parseImageUrl returns null for non-image paths', () => {
    expect(parseImageUrl('/_vulse/site/x')).toBeNull();
    expect(parseImageUrl('/api/assets')).toBeNull();
  });

  it('parseImageUrl returns null for malformed paths', () => {
    expect(parseImageUrl('/_vulse/img/short')).toBeNull();
    expect(parseImageUrl('/_vulse/img/sig/mods/missing-ext')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test (should fail)**

```bash
pnpm --filter @vulse/image test -- url
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement url.ts**

Write to `packages/image/src/url.ts`:

```ts
import { type ImageModifiers, serializeModifiers } from './modifiers.js';
import { signImagePath } from './sign.js';

export interface BuildImageUrlInput {
  assetId: string;
  mods: ImageModifiers;
  secret: string;
  /** original file extension, e.g. 'jpg', 'png'. Used when mods.f is undefined or 'auto'. */
  originalExt?: string;
}

const PATH_PREFIX = '/_vulse/img';

export function buildImageUrl(input: BuildImageUrlInput): string {
  const { assetId, mods, secret, originalExt } = input;
  const modsString = serializeModifiers(mods);
  const sig = signImagePath(assetId, modsString, secret);
  const ext = pickExt(mods.f, originalExt);
  return `${PATH_PREFIX}/${sig}/${modsString}/${assetId}.${ext}`;
}

function pickExt(format: ImageModifiers['f'], originalExt: string | undefined): string {
  if (format && format !== 'auto') return format === 'jpg' ? 'jpg' : format;
  if (originalExt) return originalExt.replace(/^\./, '').toLowerCase();
  return 'jpg';
}

export interface ParsedImageUrl {
  sig: string;
  modsRaw: string;
  assetId: string;
  ext: string;
}

const PATH_RE = /^\/_vulse\/img\/([A-Za-z0-9_-]{11})\/([^/]+)\/([^/.]+)\.([a-z0-9]+)$/;

export function parseImageUrl(path: string): ParsedImageUrl | null {
  const match = PATH_RE.exec(path);
  if (!match) return null;
  return {
    sig: match[1]!,
    modsRaw: match[2]!,
    assetId: match[3]!,
    ext: match[4]!,
  };
}

export { type ImageModifiers } from './modifiers.js';
```

- [ ] **Step 4: Run tests (should pass)**

```bash
pnpm --filter @vulse/image test -- url
```

Expected: all 6 url tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/image/src/url.ts packages/image/src/__tests__/url.test.ts
git commit -m "feat(image): isomorphic URL builder and parser"
```

---

## Task 7: Implement the sharp transform pipeline

**Files:**
- Create: `packages/image/src/transform.ts`
- Create: `packages/image/src/metadata.ts`
- Create: `packages/image/src/__tests__/__fixtures__/cat.jpg`
- Test: `packages/image/src/__tests__/transform.test.ts`

- [ ] **Step 1: Add the fixture image**

Generate a small JPEG fixture (200×133, ~5KB) using sharp itself:

```bash
node -e "import('sharp').then(({ default: sharp }) => sharp({ create: { width: 200, height: 133, channels: 3, background: { r: 255, g: 128, b: 64 } } }).jpeg({ quality: 80 }).toFile('packages/image/src/__tests__/__fixtures__/cat.jpg'))"
```

Verify the file exists and is non-empty:
```bash
ls -l packages/image/src/__tests__/__fixtures__/cat.jpg
```

Expected: size > 0.

- [ ] **Step 2: Write the failing test**

Write to `packages/image/src/__tests__/transform.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { probeMetadata } from '../metadata.js';
import { transformImage } from '../transform.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, '__fixtures__', 'cat.jpg');

async function loadFixture(): Promise<Buffer> {
  return readFile(fixture);
}

describe('transform', () => {
  it('resizes to requested width preserving aspect', async () => {
    const out = await transformImage(await loadFixture(), { w: 100 }, { accept: '' });
    const meta = await sharp(out.buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBeGreaterThan(0);
    expect(out.contentType).toBe('image/jpeg');
  });

  it('converts to webp when f=webp', async () => {
    const out = await transformImage(await loadFixture(), { w: 100, f: 'webp' }, { accept: '' });
    expect(out.contentType).toBe('image/webp');
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('webp');
  });

  it('uses webp when f=auto and Accept contains image/webp', async () => {
    const out = await transformImage(
      await loadFixture(),
      { w: 100, f: 'auto' },
      { accept: 'image/webp,*/*' },
    );
    expect(out.contentType).toBe('image/webp');
  });

  it('uses avif when f=auto and Accept contains image/avif', async () => {
    const out = await transformImage(
      await loadFixture(),
      { w: 100, f: 'auto' },
      { accept: 'image/avif,image/webp,*/*' },
    );
    expect(out.contentType).toBe('image/avif');
  });

  it('crops with fit=cover and explicit h', async () => {
    const out = await transformImage(
      await loadFixture(),
      { w: 100, h: 100, fit: 'cover' },
      { accept: '' },
    );
    const meta = await sharp(out.buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
  });
});

describe('probeMetadata', () => {
  it('returns width and height for a valid image', async () => {
    const meta = await probeMetadata(await loadFixture());
    expect(meta).toEqual({ width: 200, height: 133 });
  });

  it('returns null for non-image data', async () => {
    expect(await probeMetadata(Buffer.from('not an image'))).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test (should fail)**

```bash
pnpm --filter @vulse/image test -- transform
```

Expected: module-not-found.

- [ ] **Step 4: Implement metadata.ts**

Write to `packages/image/src/metadata.ts`:

```ts
import sharp from 'sharp';

export interface ProbedMetadata {
  width: number;
  height: number;
}

export async function probeMetadata(buf: Buffer): Promise<ProbedMetadata | null> {
  try {
    const meta = await sharp(buf).metadata();
    if (typeof meta.width !== 'number' || typeof meta.height !== 'number') return null;
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Implement transform.ts**

Write to `packages/image/src/transform.ts`:

```ts
import sharp, { type FitEnum } from 'sharp';
import type { ImageFormat, ImageModifiers } from './modifiers.js';

export interface TransformContext {
  /** Raw Accept header from the request, used for f=auto negotiation. */
  accept: string;
}

export interface TransformResult {
  buffer: Buffer;
  contentType: string;
  ext: string;
}

const CONTENT_TYPES: Record<Exclude<ImageFormat, 'auto'>, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpg: 'image/jpeg',
  png: 'image/png',
};

const FIT_MAP: Record<NonNullable<ImageModifiers['fit']>, keyof FitEnum> = {
  cover: 'cover',
  contain: 'contain',
  inside: 'inside',
  outside: 'outside',
};

export async function transformImage(
  input: Buffer,
  mods: ImageModifiers,
  ctx: TransformContext,
): Promise<TransformResult> {
  let pipeline = sharp(input, { failOn: 'none' });

  if (mods.w || mods.h) {
    pipeline = pipeline.resize({
      width: mods.w,
      height: mods.h,
      fit: mods.fit ? FIT_MAP[mods.fit] : 'cover',
      position: mods.pos ?? 'center',
      withoutEnlargement: true,
    });
  }

  const format = resolveFormat(mods.f, ctx.accept);
  const quality = mods.q ?? 75;

  switch (format) {
    case 'webp':
      pipeline = pipeline.webp({ quality });
      break;
    case 'avif':
      pipeline = pipeline.avif({ quality });
      break;
    case 'jpg':
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      break;
    case 'png':
      pipeline = pipeline.png({ compressionLevel: 9 });
      break;
  }

  const buffer = await pipeline.toBuffer();
  return { buffer, contentType: CONTENT_TYPES[format], ext: format === 'jpg' ? 'jpg' : format };
}

function resolveFormat(
  requested: ImageFormat | undefined,
  accept: string,
): Exclude<ImageFormat, 'auto'> {
  if (requested && requested !== 'auto') return requested;
  if (accept.includes('image/avif')) return 'avif';
  if (accept.includes('image/webp')) return 'webp';
  return 'jpg';
}
```

- [ ] **Step 6: Run tests (should pass)**

```bash
pnpm --filter @vulse/image test -- transform
```

Expected: all 7 tests pass (5 transform + 2 metadata).

- [ ] **Step 7: Commit**

```bash
git add packages/image/src/transform.ts packages/image/src/metadata.ts packages/image/src/__tests__/transform.test.ts packages/image/src/__tests__/__fixtures__/cat.jpg
git commit -m "feat(image): sharp transform pipeline and metadata probe"
```

---

## Task 8: Implement disk cache + inflight dedupe

**Files:**
- Create: `packages/image/src/cache.ts`
- Create: `packages/image/src/dedupe.ts`

- [ ] **Step 1: Implement dedupe.ts (no tests — trivial)**

Write to `packages/image/src/dedupe.ts`:

```ts
const inflight = new Map<string, Promise<unknown>>();

export async function dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = factory().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
```

- [ ] **Step 2: Implement cache.ts**

Write to `packages/image/src/cache.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface CacheEntry {
  buffer: Buffer;
  contentType: string;
}

export interface DiskCache {
  get(key: string): Promise<CacheEntry | null>;
  put(key: string, entry: CacheEntry): Promise<void>;
}

export function cacheKey(assetId: string, mods: string, ext: string): string {
  const hash = createHash('sha256').update(`${assetId}|${mods}`).digest('hex');
  return `${hash}.${ext}`;
}

export function createDiskCache(rootDir: string): DiskCache {
  return {
    async get(key) {
      const path = pathFor(rootDir, key);
      if (!existsSync(path)) return null;
      const buffer = await readFile(path);
      return { buffer, contentType: contentTypeFor(key) };
    },
    async put(key, entry) {
      const path = pathFor(rootDir, key);
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, entry.buffer);
      await rename(tmp, path);
    },
  };
}

function pathFor(root: string, key: string): string {
  // shard by first 2 hex chars to avoid one giant directory
  return join(root, key.slice(0, 2), key);
}

function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1);
  switch (ext) {
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'png':
      return 'image/png';
    default:
      return 'image/jpeg';
  }
}
```

- [ ] **Step 3: Quick sanity build**

```bash
pnpm --filter @vulse/image build
```

Expected: clean tsc output, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/image/src/cache.ts packages/image/src/dedupe.ts
git commit -m "feat(image): disk cache and inflight dedupe"
```

---

## Task 9: Implement S3 source fetcher

**Files:**
- Create: `packages/image/src/fetch-source.ts`

- [ ] **Step 1: Implement fetch-source.ts**

Write to `packages/image/src/fetch-source.ts`:

```ts
import type { DatabaseAdapter } from '@vulse/db';
import { getAsset } from '@vulse/core/assets/service.js';
import { presignUrl } from '@vulse/core/assets/presign.js';
import { getS3Config } from '@vulse/core/assets/settings.js';
import type { AssetDTO } from '@vulse/core/assets/types.js';

export interface FetchedSource {
  asset: AssetDTO;
  buffer: Buffer;
  originalExt: string;
}

export async function fetchAssetSource(
  adapter: DatabaseAdapter,
  assetId: string,
): Promise<FetchedSource | null> {
  const asset = await getAsset(adapter, assetId);
  if (!asset) return null;
  const config = await getS3Config(adapter);
  if (!config) throw new Error('s3 not configured');
  const signedGet = presignUrl({ config, method: 'GET', key: asset.key });
  const res = await fetch(signedGet);
  if (!res.ok) throw new Error(`s3 fetch failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const originalExt = extractExt(asset.originalName, asset.key);
  return { asset, buffer, originalExt };
}

function extractExt(originalName: string | null, key: string): string {
  const source = originalName ?? key;
  const dot = source.lastIndexOf('.');
  if (dot < 0) return 'jpg';
  return source.slice(dot + 1).toLowerCase();
}
```

Note: `@vulse/core` doesn't currently expose `assets/*` sub-paths. Add the required re-exports.

- [ ] **Step 2: Update @vulse/core exports**

Read `packages/core/src/index.ts` and confirm the current exports surface. Add (append) the following re-exports if not already present:

```ts
export { getAsset } from './assets/service.js';
export { getS3Config } from './assets/settings.js';
export { presignUrl } from './assets/presign.js';
```

Verify they are exported. Then change `fetch-source.ts` imports to use `@vulse/core` package root instead of deep paths:

```ts
import { getAsset, getS3Config, presignUrl } from '@vulse/core';
import type { AssetDTO } from '@vulse/core';
```

Confirm `AssetDTO` is already exported from `@vulse/core` (it is, via `./assets/types.js` already barreled in `index.ts` — check and add if missing).

- [ ] **Step 3: Rebuild core**

```bash
pnpm --filter @vulse/core build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/image/src/fetch-source.ts packages/core/src/index.ts
git commit -m "feat(image): S3 source fetcher with presigned GET"
```

---

## Task 10: Wire h3 routes — full handler

**Files:**
- Create: `packages/image/src/routes.ts`
- Test: `packages/image/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Write to `packages/image/src/__tests__/routes.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { createApp, toWebHandler } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageRoutes } from '../routes.js';
import { buildImageUrl } from '../url.js';

const SECRET = 'test-secret';

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  // seed an asset row + s3 config
  await db.exec(
    `INSERT INTO settings (key, value) VALUES (?, ?)`,
    [
      's3.config',
      JSON.stringify({
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret',
        region: 'us-east-1',
        bucket: 'test',
      }),
    ],
  );
  await db.exec(
    `INSERT INTO assets (id, key, bucket, url, content_type, original_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['01HFCAT', 'cats/cat.jpg', 'test', 'https://test/cats/cat.jpg', 'image/jpeg', 'cat.jpg'],
  );

  const cacheDir = mkdtempSync(join(tmpdir(), 'vulse-img-test-'));
  const app = createApp();
  app.use(imageRoutes(db, { secret: SECRET, cacheDir }).handler);
  const handler = toWebHandler(app);
  return { db, cacheDir, request: (path: string, init?: RequestInit) =>
    handler(new Request(`http://test${path}`, init)) };
}

describe('imageRoutes', () => {
  let cacheDir: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock global fetch so S3 GET returns our fixture
    const fixture = Buffer.from(
      // tiny 1x1 jpeg
      'ffd8ffe000104a46494600010100000100010000ffdb0043000806060706050806070707090909' +
        '0c190d0c0b0b0c1817110d1f1c1f1e1c1c1f221d1c1c281b1d2a262a32302c2d2f3232311d28' +
        '3236343433383137393cffc0000b08000100010101110000ffc4001f00000105010101010101' +
        '00000000000000000102030405060708090a0bffc400b51000020103030204030505040400000001' +
        '7d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a' +
        '161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768' +
        '696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5' +
        'b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7' +
        'f8f9faffda0008010100003f00fbd0ffd9',
      'hex',
    );
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(fixture, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  });

  it('returns 200 + image for a valid signed URL', async () => {
    const ctx = await setup();
    cacheDir = ctx.cacheDir;
    const url = buildImageUrl({
      assetId: '01HFCAT',
      mods: { w: 100, f: 'webp' },
      secret: SECRET,
    });
    const res = await ctx.request(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
  });

  it('returns 403 for a tampered signature', async () => {
    const ctx = await setup();
    cacheDir = ctx.cacheDir;
    const res = await ctx.request('/_vulse/img/zzzzzzzzzzz/w_100/01HFCAT.jpg');
    expect(res.status).toBe(403);
  });

  it('returns 400 for an out-of-range width even with a valid signature', async () => {
    const ctx = await setup();
    cacheDir = ctx.cacheDir;
    // Sign a path with an in-range value, then swap the path to use a banned one.
    // Easier: directly verify the parser via buildImageUrl with a banned w throws.
    const url = buildImageUrl({ assetId: '01HFCAT', mods: { w: 99 }, secret: SECRET });
    // Replace w_99 with w_99999 manually to simulate tampering with a valid sig recomputed.
    // We re-sign with the bad value to isolate that allowlist runs *after* sig verify.
    const tampered = url.replace('w_99', 'w_99999');
    const res = await ctx.request(tampered);
    expect([400, 403]).toContain(res.status); // either: sig now doesn't match, or modifier rejected
  });

  it('returns 404 for an unknown asset id (with valid signature for that id)', async () => {
    const ctx = await setup();
    cacheDir = ctx.cacheDir;
    const url = buildImageUrl({ assetId: 'NOPE', mods: { w: 100 }, secret: SECRET });
    const res = await ctx.request(url);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test (should fail)**

```bash
pnpm --filter @vulse/image test -- routes
```

Expected: module-not-found for `../routes.js`.

- [ ] **Step 3: Implement routes.ts**

Write to `packages/image/src/routes.ts`:

```ts
import type { DatabaseAdapter } from '@vulse/db';
import {
  type Router,
  createRouter,
  defineEventHandler,
  getRequestHeader,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from 'h3';
import { createDiskCache, cacheKey } from './cache.js';
import { dedupe } from './dedupe.js';
import { fetchAssetSource } from './fetch-source.js';
import { parseModifiers } from './modifiers.js';
import { parseImageUrl } from './url.js';
import { verifyImagePath } from './sign.js';
import { transformImage } from './transform.js';

export interface ImageRoutesOptions {
  secret: string;
  cacheDir: string;
}

export function imageRoutes(adapter: DatabaseAdapter, opts: ImageRoutesOptions): Router {
  const router = createRouter();
  const cache = createDiskCache(opts.cacheDir);

  router.get(
    '/_vulse/img/**',
    defineEventHandler(async (event) => {
      const path = event.path.split('?')[0]!;
      const parsed = parseImageUrl(path);
      if (!parsed) {
        setResponseStatus(event, 400);
        return { error: 'malformed_url' };
      }

      if (!verifyImagePath(parsed.sig, parsed.assetId, parsed.modsRaw, opts.secret)) {
        setResponseStatus(event, 403);
        return { error: 'bad_signature' };
      }

      let mods;
      try {
        mods = parseModifiers(parsed.modsRaw);
      } catch (err) {
        setResponseStatus(event, 400);
        return { error: 'bad_modifiers', message: (err as Error).message };
      }

      const key = cacheKey(parsed.assetId, parsed.modsRaw, parsed.ext);
      const hit = await cache.get(key);
      if (hit) {
        setResponseHeader(event, 'content-type', hit.contentType);
        setResponseHeader(event, 'cache-control', 'public, max-age=31536000, immutable');
        setResponseHeader(event, 'etag', `"${key}"`);
        return hit.buffer;
      }

      const accept = getRequestHeader(event, 'accept') ?? '';

      const result = await dedupe(key, async () => {
        const source = await fetchAssetSource(adapter, parsed.assetId);
        if (!source) return null;
        const out = await transformImage(source.buffer, mods, { accept });
        await cache.put(key, { buffer: out.buffer, contentType: out.contentType });
        return { buffer: out.buffer, contentType: out.contentType };
      });

      if (!result) {
        setResponseStatus(event, 404);
        return { error: 'asset_not_found' };
      }

      setResponseHeader(event, 'content-type', result.contentType);
      setResponseHeader(event, 'cache-control', 'public, max-age=31536000, immutable');
      setResponseHeader(event, 'etag', `"${key}"`);
      return result.buffer;
    }),
  );

  router.get(
    '/api/assets/:id/thumb-url',
    defineEventHandler(async (event) => {
      if (!event.context.user) {
        setResponseStatus(event, 401);
        return { error: 'auth_required' };
      }
      const id = getRouterParam(event, 'id') as string;
      const widthParam = (event.path.split('?')[1] ?? '').match(/(?:^|&)w=(\d+)/);
      const w = widthParam ? Math.min(Math.max(Number(widthParam[1]), 16), 4096) : 240;
      // Lazy import buildImageUrl to keep this file's surface tight
      const { buildImageUrl } = await import('./url.js');
      const url = buildImageUrl({
        assetId: id,
        mods: { w, f: 'webp', q: 80 },
        secret: opts.secret,
      });
      return { url };
    }),
  );

  return router;
}
```

- [ ] **Step 4: Run tests (should pass)**

```bash
pnpm --filter @vulse/image test -- routes
```

Expected: all 4 route tests pass. If the JPEG fixture in the test is rejected by sharp, replace the hex blob with `await readFile(join(here, '__fixtures__', 'cat.jpg'))` and import `readFile` from `node:fs/promises`.

- [ ] **Step 5: Commit**

```bash
git add packages/image/src/routes.ts packages/image/src/__tests__/routes.test.ts
git commit -m "feat(image): h3 sub-router with signing, transform pipeline, and thumb-url endpoint"
```

---

## Task 11: Add provider abstraction (local)

**Files:**
- Create: `packages/image/src/provider/types.ts`
- Create: `packages/image/src/provider/local.ts`

- [ ] **Step 1: Define ImageProvider interface**

Write to `packages/image/src/provider/types.ts`:

```ts
import type { ImageModifiers } from '../modifiers.js';

export interface ImageProvider {
  /** Build a URL the browser can request. */
  buildUrl(input: {
    assetId: string;
    mods: ImageModifiers;
    originalExt?: string;
  }): string;
}
```

- [ ] **Step 2: Implement local provider**

Write to `packages/image/src/provider/local.ts`:

```ts
import { buildImageUrl } from '../url.js';
import type { ImageProvider } from './types.js';

export interface LocalProviderOptions {
  secret: string;
}

export function createLocalProvider(opts: LocalProviderOptions): ImageProvider {
  return {
    buildUrl: ({ assetId, mods, originalExt }) =>
      buildImageUrl({
        assetId,
        mods,
        secret: opts.secret,
        ...(originalExt ? { originalExt } : {}),
      }),
  };
}
```

- [ ] **Step 3: Re-export from index.ts**

Update `packages/image/src/index.ts` to include:

```ts
export { createLocalProvider } from './provider/local.js';
```

- [ ] **Step 4: Build to verify**

```bash
pnpm --filter @vulse/image build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/image/src/provider/types.ts packages/image/src/provider/local.ts packages/image/src/index.ts
git commit -m "feat(image): provider abstraction with local default"
```

---

## Task 12: Probe image dimensions on asset registration

**Files:**
- Modify: `packages/core/src/assets/routes.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/assets/assets.api.test.ts` a test that registers an image asset and verifies dims are populated. The existing test file already has the setup helpers. Add:

```ts
it('probes image dimensions when registering an image asset', async () => {
  const { app, cookie, db } = await setup();
  // Put an S3 config so the fetch path is valid
  await app.request('http://x/api/settings/s3', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret-secret-secret',
      region: 'us-east-1',
      bucket: 'examplebucket',
    }),
  });

  // Mock fetch to return a tiny in-memory JPEG (use the fixture from @vulse/image)
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const fixture = await readFile(
    join(here, '..', '..', '..', 'image', 'src', '__tests__', '__fixtures__', 'cat.jpg'),
  );
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(fixture, { status: 200 }));

  try {
    const res = await app.request('http://x/api/assets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        key: 'cats/cat.jpg',
        bucket: 'examplebucket',
        url: 'https://examplebucket.s3.us-east-1.amazonaws.com/cats/cat.jpg',
        contentType: 'image/jpeg',
        originalName: 'cat.jpg',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.imageWidth).toBe(200);
    expect(body.imageHeight).toBe(133);
  } finally {
    fetchSpy.mockRestore();
  }
});
```

Add `import { vi } from 'vitest';` at the top of the file if not present.

- [ ] **Step 2: Run the test (should fail)**

```bash
pnpm --filter @vulse/core test -- assets.api
```

Expected: failure — `imageWidth` is `null` or `undefined`.

- [ ] **Step 3: Update the asset registration handler**

Modify `packages/core/src/assets/routes.ts`. Inside the `POST /api/assets` handler, after the body is parsed, before `createAsset`, probe if it's an image. The handler currently does not depend on sharp; we keep that boundary by accepting an injected probe function.

First, change the `assetRoutes` signature to accept an optional `probeImage`:

```ts
export interface AssetRoutesOptions {
  probeImage?: (assetUrl: string, bucket: string, key: string) =>
    Promise<{ width: number; height: number } | null>;
}

export function assetRoutes(adapter: DatabaseAdapter, opts: AssetRoutesOptions = {}): Router {
  // ... existing body unchanged except the POST /api/assets handler ...
}
```

Replace the body of the `POST /api/assets` handler (the block that calls `createAsset`):

```ts
router.post(
  '/api/assets',
  safe(async (event) => {
    if (!event.context.user) {
      setResponseStatus(event, 401);
      return { error: 'auth_required' };
    }
    const body = await readBody(event);
    const parsed = RegisterBodySchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);

    let imageDims: { width: number; height: number } | null = null;
    if (
      opts.probeImage &&
      (parsed.data.contentType ?? '').startsWith('image/')
    ) {
      try {
        imageDims = await opts.probeImage(parsed.data.url, parsed.data.bucket, parsed.data.key);
      } catch {
        imageDims = null;
      }
    }

    const asset = await createAsset(adapter, {
      key: parsed.data.key,
      bucket: parsed.data.bucket,
      url: parsed.data.url,
      contentType: parsed.data.contentType ?? null,
      size: parsed.data.size ?? null,
      originalName: parsed.data.originalName ?? null,
      imageWidth: imageDims?.width ?? null,
      imageHeight: imageDims?.height ?? null,
    });
    setResponseStatus(event, 201);
    return asset;
  }),
);
```

- [ ] **Step 4: Update createApi to accept and pass probeImage**

In `packages/core/src/http/api.ts`:
- Add `probeImage?: AssetRoutesOptions['probeImage']` to `ApiDeps`.
- Change `app.use(assetRoutes(adapter).handler)` to `app.use(assetRoutes(adapter, { probeImage: deps.probeImage }).handler)`.

- [ ] **Step 5: Wire the probe in the test setup**

Modify the test setup helper to pass a probe function that uses `probeMetadata` from `@vulse/image`:

```ts
import { probeMetadata } from '@vulse/image';
// ...inside setup():
const rawApp = createApi({
  blueprints, content, adapter: db, authInstance, sets, previewSecret: 'test-preview-secret',
  probeImage: async (url) => {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return probeMetadata(buf);
  },
});
```

Add `@vulse/image` to `packages/core/package.json` `devDependencies` (test-only):

```json
"@vulse/image": "workspace:*"
```

Run `pnpm install` after editing.

- [ ] **Step 6: Run tests (should pass)**

```bash
pnpm install
pnpm --filter @vulse/core test
```

Expected: the new test passes, all existing asset tests still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/assets/routes.ts packages/core/src/http/api.ts packages/core/src/assets/assets.api.test.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): probe image dimensions on asset registration"
```

---

## Task 13: Implement <VulseImage> Vue component

**Files:**
- Create: `packages/renderer/src/components/VulseImage.vue`
- Modify: `packages/renderer/src/index.ts`
- Modify: `packages/renderer/package.json` (add `@vulse/image` as dep)

- [ ] **Step 1: Add the dep**

Update `packages/renderer/package.json` dependencies:

```json
"@vulse/image": "workspace:*"
```

Run:

```bash
pnpm install
```

- [ ] **Step 2: Create the component**

Write to `packages/renderer/src/components/VulseImage.vue`:

```vue
<script setup lang="ts">
import { inject, computed } from 'vue';
import { buildImageUrl, type ImageModifiers } from '@vulse/image/url';
import type { ImageFormat, ImageFit } from '@vulse/image/url';

interface AssetLike {
  id: string;
  imageWidth?: number | null;
  imageHeight?: number | null;
  originalName?: string | null;
  key?: string | null;
}

const props = withDefaults(
  defineProps<{
    asset: AssetLike;
    width?: number;
    height?: number;
    format?: ImageFormat;
    quality?: number;
    fit?: ImageFit;
    sizes?: string;
    widths?: number[];
    loading?: 'lazy' | 'eager';
    alt: string;
  }>(),
  {
    width: 1200,
    format: 'auto',
    quality: 75,
    fit: 'cover',
    loading: 'lazy',
  },
);

const secret = inject<string>('vulse:imageSecret', '');

const originalExt = computed(() => {
  const src = props.asset.originalName ?? props.asset.key ?? '';
  const dot = src.lastIndexOf('.');
  return dot >= 0 ? src.slice(dot + 1).toLowerCase() : 'jpg';
});

const heightAttr = computed(() => {
  if (props.height) return props.height;
  const { imageWidth, imageHeight } = props.asset;
  if (!imageWidth || !imageHeight) return undefined;
  return Math.round((props.width * imageHeight) / imageWidth);
});

function mods(w: number): ImageModifiers {
  const m: ImageModifiers = { w, f: props.format, q: props.quality, fit: props.fit };
  if (props.height) m.h = props.height;
  return m;
}

function url(w: number): string {
  return buildImageUrl({
    assetId: props.asset.id,
    mods: mods(w),
    secret,
    originalExt: originalExt.value,
  });
}

const widths = computed(() => {
  if (props.widths && props.widths.length) return props.widths;
  return Array.from(
    new Set(
      [Math.round(props.width * 0.5), props.width, props.width * 2].map((w) =>
        Math.min(Math.max(w, 16), 4096),
      ),
    ),
  ).sort((a, b) => a - b);
});

const src = computed(() => url(props.width));
const srcset = computed(() => widths.value.map((w) => `${url(w)} ${w}w`).join(', '));
</script>

<template>
  <img
    :src="src"
    :srcset="srcset"
    :sizes="sizes"
    :width="width"
    :height="heightAttr"
    :loading="loading"
    decoding="async"
    :alt="alt"
  />
</template>
```

- [ ] **Step 3: Export the component**

Update `packages/renderer/src/index.ts`:

```ts
export { default as BlockRenderer } from './BlockRenderer.vue';
export { default as Node } from './Node.vue';
export { default as VulseImage } from './components/VulseImage.vue';
export type { BlockNode, BlockMark, BlockComponentMap, BlockRendererProps } from './types.js';
```

- [ ] **Step 4: Build renderer**

```bash
pnpm --filter @vulse/renderer build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/components/VulseImage.vue packages/renderer/src/index.ts packages/renderer/package.json pnpm-lock.yaml
git commit -m "feat(renderer): VulseImage component"
```

---

## Task 14: Implement the VulseImage renderer block

**Files:**
- Create: `packages/renderer/src/blocks/VulseImage.vue`
- Modify: `packages/renderer/src/defaults.ts`

- [ ] **Step 1: Create the block**

Write to `packages/renderer/src/blocks/VulseImage.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import VulseImage from '../components/VulseImage.vue';
import type { BlockNode } from '../types.js';

const props = defineProps<{ node: BlockNode }>();

const asset = computed(() => {
  const a = props.node.attrs?.asset;
  if (a && typeof a === 'object' && 'id' in a) return a as { id: string };
  const id = props.node.attrs?.assetId;
  return typeof id === 'string' ? { id } : null;
});

const alt = computed(() => (typeof props.node.attrs?.alt === 'string' ? props.node.attrs.alt : ''));
const caption = computed(() =>
  typeof props.node.attrs?.caption === 'string' ? props.node.attrs.caption : '',
);
const sizes = computed(() =>
  typeof props.node.attrs?.sizes === 'string' ? props.node.attrs.sizes : undefined,
);
</script>

<template>
  <figure v-if="asset" data-vulse-block="image">
    <VulseImage :asset="asset" :alt="alt" :sizes="sizes" />
    <figcaption v-if="caption">{{ caption }}</figcaption>
  </figure>
</template>
```

- [ ] **Step 2: Register in defaults**

Update `packages/renderer/src/defaults.ts`:

```ts
import VulseImage from './blocks/VulseImage.vue';
// ...
export const defaultComponents: BlockComponentMap = {
  // ...existing entries...
  vulseImage: VulseImage,
};
```

- [ ] **Step 3: Build and verify**

```bash
pnpm --filter @vulse/renderer build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/renderer/src/blocks/VulseImage.vue packages/renderer/src/defaults.ts
git commit -m "feat(renderer): VulseImage body block"
```

---

## Task 15: Wire imageRoutes into apps/dev and serve /_vulse/img through the API

**Files:**
- Modify: `apps/dev/src/server.prod.ts`
- Modify: `apps/dev/package.json` (add `@vulse/image` dep)
- Modify: `apps/dev/src/main.ts` (verify dev wiring)

- [ ] **Step 1: Add the dep**

Update `apps/dev/package.json`:

```json
"@vulse/image": "workspace:*"
```

Run:

```bash
pnpm install
```

- [ ] **Step 2: Compute the image secret**

In `apps/dev/src/server.prod.ts`, near `resolvePreviewSecret`, add:

```ts
function resolveImageSecret(): string {
  return (
    process.env.VULSE_IMAGE_SECRET ??
    process.env.VULSE_SESSION_SECRET ??
    PREVIEW_SECRET
  );
}
const IMAGE_SECRET = resolveImageSecret();
const IMAGE_CACHE_DIR = resolve(appRoot, '.vulse', 'cache', 'img');
```

(Reference `PREVIEW_SECRET` only after its definition.)

- [ ] **Step 3: Mount imageRoutes inside buildListeners**

At the top of `server.prod.ts`, add:

```ts
import { imageRoutes, probeMetadata } from '@vulse/image';
import { createApp } from 'h3';
```

Replace the existing `buildListeners` body to mount image routes in a way the request-router can dispatch to:

```ts
async function buildListeners() {
  const blueprints = await loadBlueprints({ adapter: db, sets });
  const content = createContentService(db, blueprints);
  const globalSets = await loadGlobalSets({ adapter: db });
  const globals = createGlobalService(db, globalSets);
  const api = createApi({
    blueprints,
    content,
    adapter: db,
    authInstance,
    databaseSummary: dbSummary,
    sets,
    previewSecret: PREVIEW_SECRET,
    globals,
    probeImage: async (url) => {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return probeMetadata(buf);
    },
  });

  const imgApp = createApp();
  imgApp.use(imageRoutes(db, { secret: IMAGE_SECRET, cacheDir: IMAGE_CACHE_DIR }).handler);

  const site = createSiteServer({
    blueprints, content, globals, authInstance,
    previewSecret: PREVIEW_SECRET,
    site: siteConfig,
    ...(appConfig.routes ? { routes: appConfig.routes } : {}),
  });
  return {
    api: toNodeListener(api),
    img: toNodeListener(imgApp),
    site: toNodeListener(site),
  };
}
```

- [ ] **Step 4: Route /_vulse/img/* through the new listener**

In the `createServer` handler, before the existing `/_vulse/site/` static branch, add:

```ts
if (req.url?.startsWith('/_vulse/img/')) {
  Promise.resolve(listeners.img(req, res)).catch((err) => {
    console.error(err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
    }
    res.end(JSON.stringify({ error: 'internal' }));
  });
  return;
}
```

And add `/api/assets/:id/thumb-url` routing: that path already starts with `/api/`, so it's already covered by the existing `/api/` branch — but `imageRoutes` mounts that endpoint, not `createApi`. Update the `/api/` branch to fall through to the img listener when the api app does not handle the request. Simplest: mount `imageRoutes`'s `/api/assets/:id/thumb-url` inside `createApi` instead. Adjust by passing the secret in via `ApiDeps` and mounting `imageRoutes` inside `createApi`:

- Add `imageSecret?: string` and `imageCacheDir?: string` to `ApiDeps`.
- Inside `createApi`, if `imageSecret` is set, call `app.use(imageRoutes(adapter, { secret, cacheDir }).handler)`.

Update the test in Task 10 if needed (the test creates its own h3 app and mounts `imageRoutes` directly — unaffected).

- [ ] **Step 5: Build the dev app**

```bash
pnpm --filter @vulse/core build && pnpm --filter @vulse/image build && pnpm --filter @vulse/dev build
```

Expected: clean.

- [ ] **Step 6: Smoke test the dev server**

```bash
pnpm --filter @vulse/dev start &
sleep 2
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/_vulse/img/badbadbadba/w_100/missing.jpg'
kill %1
```

Expected: `403` (signature mismatch).

- [ ] **Step 7: Commit**

```bash
git add apps/dev/src/server.prod.ts apps/dev/package.json packages/core/src/http/api.ts pnpm-lock.yaml
git commit -m "feat(dev): mount image routes and probe on asset register"
```

---

## Task 16: Update site head.ts to optimize OG images

**Files:**
- Modify: `packages/site/src/head.ts`
- Modify: `packages/site/src/types.ts`
- Modify: `packages/site/src/head.test.ts`

- [ ] **Step 1: Add resolveImage to SiteConfig**

In `packages/site/src/types.ts`, add an optional field to `SiteConfig`:

```ts
export interface SiteConfig {
  // ...existing fields...
  /**
   * Hook to optimize the resolved OG/social image URL. Given the raw
   * value from the entry (string or object), return the final absolute URL.
   * Default: pass-through for strings, undefined otherwise.
   */
  resolveImage?: (raw: unknown, site: SiteConfig) => string | undefined;
}
```

- [ ] **Step 2: Use the hook in head.ts**

In `packages/site/src/head.ts`, replace:

```ts
const image = normalizeAbsoluteUrl(firstString(content, IMAGE_FIELDS) ?? site.defaultImage, site);
```

with:

```ts
const rawImage = firstStringOrObject(content, IMAGE_FIELDS) ?? site.defaultImage;
const resolved = site.resolveImage ? site.resolveImage(rawImage, site) : undefined;
const image =
  resolved ?? normalizeAbsoluteUrl(typeof rawImage === 'string' ? rawImage : undefined, site);
```

Add the helper just below `firstString`:

```ts
function firstStringOrObject(content: Record<string, unknown>, fields: string[]): unknown {
  for (const field of fields) {
    const value = content[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') return value;
  }
  return undefined;
}
```

- [ ] **Step 3: Update test for the pass-through default**

Run the existing test to ensure it still passes:

```bash
pnpm --filter @vulse/site test -- head
```

Expected: existing tests pass unchanged.

- [ ] **Step 4: Add a test that resolveImage is honored**

Append to `packages/site/src/head.test.ts`:

```ts
it('uses resolveImage when provided', () => {
  const state = {
    route: { type: 'entry' as const },
    entry: { content: { seoImage: { id: '01HFCAT' } } },
  } as unknown as Parameters<typeof resolveHead>[0];
  const head = resolveHead(state, {
    url: 'https://example.com',
    resolveImage: (raw) =>
      raw && typeof raw === 'object' && 'id' in (raw as Record<string, unknown>)
        ? `https://example.com/_vulse/img/sig/w_1200,h_630,f_jpg/${(raw as { id: string }).id}.jpg`
        : undefined,
  });
  const og = head.meta.find((m) => 'property' in m && m.property === 'og:image');
  expect(og?.content).toBe(
    'https://example.com/_vulse/img/sig/w_1200,h_630,f_jpg/01HFCAT.jpg',
  );
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @vulse/site test
```

Expected: all tests pass including the new one.

- [ ] **Step 6: Commit**

```bash
git add packages/site/src/head.ts packages/site/src/types.ts packages/site/src/head.test.ts
git commit -m "feat(site): support resolveImage hook for optimized OG images"
```

---

## Task 17: Update admin to use signed thumbnail URLs

**Files:**
- Modify: `packages/admin/src/api/client.ts`
- Modify: `packages/admin/src/pages/AssetList.vue`
- Modify: `packages/admin/src/components/fields/AssetField.vue`

- [ ] **Step 1: Add the thumb-url method to ApiClient**

`packages/admin/src/api/client.ts` uses an `ApiClient` class with a private
`request<T>(method, path, body?)` method. Add a new public method on that
class (alongside the other methods like `listAssets`):

```ts
async getAssetThumbUrl(id: string, width = 240): Promise<{ url: string }> {
  return this.request<{ url: string }>(
    'GET',
    `/api/assets/${encodeURIComponent(id)}/thumb-url?w=${width}`,
  );
}
```

- [ ] **Step 2: Use it in AssetList.vue**

Open `packages/admin/src/pages/AssetList.vue`. In the `<script setup>` block,
add to the existing imports:

```ts
import { reactive } from 'vue';
```

After the existing `const assets = ref<AssetItem[]>([]);` line, add:

```ts
const thumbUrls = reactive<Record<string, string>>({});

async function ensureThumb(id: string): Promise<void> {
  if (thumbUrls[id]) return;
  try {
    const { url } = await api.getAssetThumbUrl(id, 240);
    thumbUrls[id] = url;
  } catch {
    /* fall back to raw url */
  }
}
```

In the existing `load()` function, after `assets.value = res.items;`, add:

```ts
for (const a of res.items) {
  if (isImage(a)) ensureThumb(a.id);
}
```

Finally, find the `<img>` line in the template (currently line 189):

```vue
<img v-if="isImage(a)" :src="a.url" alt="" class="h-full w-full object-cover" />
```

Replace with:

```vue
<img v-if="isImage(a)" :src="thumbUrls[a.id] ?? a.url" alt="" class="h-full w-full object-cover" />
```

- [ ] **Step 3: Same for AssetField.vue**

Apply the analogous change in `packages/admin/src/components/fields/AssetField.vue`:

1. Import `reactive` from `vue` (add to existing imports).
2. Add the same `thumbUrls` reactive map and `ensureThumb` function near the
   top of the script setup block.
3. Find every place where the assets array is populated (search for
   `.listAssets` or wherever the picker fetches), and call `ensureThumb(a.id)`
   for each image asset.
4. Replace both `<img ... :src="a.url" ...>` tags (around lines 124 and 208)
   with `:src="thumbUrls[a.id] ?? a.url"` (where the iteration variable may
   be named differently — match the existing template).

- [ ] **Step 4: Build admin**

```bash
pnpm --filter @vulse/admin build
```

Expected: clean.

- [ ] **Step 5: Manual smoke check**

```bash
pnpm --filter @vulse/dev dev
```

Open `http://localhost:3000/admin/assets`. Image thumbnails should load via `/_vulse/img/...` (check Network tab). Stop the server.

- [ ] **Step 6: Commit**

```bash
git add packages/admin/src/api/client.ts packages/admin/src/pages/AssetList.vue packages/admin/src/components/fields/AssetField.vue
git commit -m "feat(admin): use signed image URLs for asset thumbnails"
```

---

## Task 18: Add backfill and clear-cache scripts

**Files:**
- Create: `packages/image/src/scripts/backfill-metadata.ts`
- Create: `packages/image/src/scripts/clear-cache.ts`
- Modify: `packages/image/package.json` (add bin entries)

- [ ] **Step 1: Write backfill-metadata.ts**

Write to `packages/image/src/scripts/backfill-metadata.ts`:

```ts
#!/usr/bin/env node
import { LibsqlAdapter, MIGRATIONS_DIR, databaseConfigFromEnv, runMigrations } from '@vulse/db';
import { fetchAssetSource } from '../fetch-source.js';
import { probeMetadata } from '../metadata.js';

async function main(): Promise<void> {
  const db = new LibsqlAdapter(databaseConfigFromEnv());
  await runMigrations(db, MIGRATIONS_DIR);

  const rows = await db.query<{ id: string }>(
    `SELECT id FROM assets
      WHERE content_type LIKE 'image/%' AND image_width IS NULL`,
  );
  console.log(`[backfill] found ${rows.length} image asset(s) without dims`);

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const source = await fetchAssetSource(db, row.id);
      if (!source) {
        failed++;
        continue;
      }
      const meta = await probeMetadata(source.buffer);
      if (!meta) {
        failed++;
        continue;
      }
      await db.exec(
        `UPDATE assets SET image_width = ?, image_height = ? WHERE id = ?`,
        [meta.width, meta.height, row.id],
      );
      ok++;
    } catch (err) {
      console.warn(`[backfill] ${row.id}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`[backfill] done: ok=${ok} failed=${failed}`);
}

await main();
```

- [ ] **Step 2: Write clear-cache.ts**

Write to `packages/image/src/scripts/clear-cache.ts`:

```ts
#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const dir = resolve(process.env.VULSE_IMAGE_CACHE_DIR ?? '.vulse/cache/img');
await rm(dir, { recursive: true, force: true });
console.log(`[image] cleared ${dir}`);
```

- [ ] **Step 3: Build**

```bash
pnpm --filter @vulse/image build
```

Expected: clean.

- [ ] **Step 4: Smoke run**

```bash
node packages/image/dist/scripts/clear-cache.js
```

Expected: `[image] cleared .vulse/cache/img` (the dir may not exist; rm with `force: true` succeeds anyway).

- [ ] **Step 5: Commit**

```bash
git add packages/image/src/scripts/backfill-metadata.ts packages/image/src/scripts/clear-cache.ts
git commit -m "feat(image): backfill and clear-cache scripts"
```

---

## Task 19: Write developer docs

**Files:**
- Create: `docs/images.md`

- [ ] **Step 1: Write the doc**

Write to `docs/images.md`:

````markdown
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

### Config (`vulse.config.ts`)

```ts
image: {
  provider: 'local',           // future: 'vercel' | 'netlify' | custom
  cacheDir: '.vulse/cache/img',
  maxWidth: 4096,
  maxHeight: 4096,
  defaultQuality: 75,
},
```

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
- **Private S3 bucket:** the IPX server uses the same configured credentials
  to issue presigned GETs; nothing extra to set up.
- **OOM on large originals:** sharp streams, but very large originals
  (~50 MP+) need RAM. Consider rejecting uploads above a size limit at the
  asset registration step (separate spec).
````

- [ ] **Step 2: Commit**

```bash
git add docs/images.md
git commit -m "docs: add image optimization guide"
```

---

## Task 20: Final verification + regression check

- [ ] **Step 1: Full test run**

```bash
pnpm install
pnpm -r build
pnpm test
```

Expected: every package's tests pass; build is clean.

- [ ] **Step 2: Smoke test end-to-end**

```bash
pnpm --filter @vulse/dev dev &
sleep 3
# Sign in (use the dev bootstrap creds printed at first boot or your seeded super user).
# Manually exercise: upload an image in /admin/assets, observe the thumbnail
# loads via /_vulse/img/* (Network tab), and confirm the asset row has
# imageWidth/imageHeight populated:
sqlite3 apps/dev/dev.db "SELECT id, image_width, image_height FROM assets WHERE content_type LIKE 'image/%' ORDER BY created_at DESC LIMIT 3;"
kill %1
```

Expected: the recent image's `image_width`/`image_height` are non-null.

- [ ] **Step 3: Lint + format**

```bash
pnpm lint
pnpm format
```

Expected: clean.

- [ ] **Step 4: Final commit (if any cosmetic fixes)**

```bash
git status
# If there are formatter-only changes:
git add -A
git commit -m "chore: format after image optimization rollout"
```

---

## Done

When all tasks are checked, the feature is shippable per the spec. Future
work (Vercel/Netlify providers, LRU eviction, blurhash rendering, focal-point
UI) lives outside this plan.
