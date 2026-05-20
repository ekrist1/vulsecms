import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { createApp, toWebHandler } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageRoutes } from '../routes.js';
import { buildImageUrl } from '../url.js';

const SECRET = 'test-secret';
const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '__fixtures__', 'cat.jpg');

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  await db.exec(`INSERT INTO settings (key, value) VALUES (?, ?)`, [
    's3.config',
    JSON.stringify({
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      bucket: 'test',
    }),
  ]);
  await db.exec(
    `INSERT INTO assets (id, key, bucket, url, content_type, original_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['01HFCAT', 'cats/cat.jpg', 'test', 'https://test/cats/cat.jpg', 'image/jpeg', 'cat.jpg'],
  );

  const cacheDir = mkdtempSync(join(tmpdir(), 'vulse-img-test-'));
  const app = createApp();
  app.use(imageRoutes(db, { secret: SECRET, cacheDir }).handler);
  const handler = toWebHandler(app);
  return {
    db,
    cacheDir,
    request: (path: string, init?: RequestInit) => handler(new Request(`http://test${path}`, init)),
  };
}

describe('imageRoutes', () => {
  let cacheDir: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: ReturnType<typeof vi.spyOn<any, any>>;

  beforeEach(async () => {
    const fixture = await readFile(fixturePath);
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(fixture, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
    cacheDir = undefined;
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

  it('returns 400 or 403 for an out-of-range width', async () => {
    const ctx = await setup();
    cacheDir = ctx.cacheDir;
    const url = buildImageUrl({ assetId: '01HFCAT', mods: { w: 99 }, secret: SECRET });
    const tampered = url.replace('w_99', 'w_99999');
    const res = await ctx.request(tampered);
    expect([400, 403]).toContain(res.status);
  });

  it('returns 404 for an unknown asset id', async () => {
    const ctx = await setup();
    cacheDir = ctx.cacheDir;
    const url = buildImageUrl({ assetId: 'NOPE', mods: { w: 100 }, secret: SECRET });
    const res = await ctx.request(url);
    expect(res.status).toBe(404);
  });

  it('f=auto returns image/webp content-type and preserves it on cache hit', async () => {
    const ctx = await setup();
    cacheDir = ctx.cacheDir;
    const url = buildImageUrl({ assetId: '01HFCAT', mods: { w: 100, f: 'auto' }, secret: SECRET });
    const acceptHeader = { accept: 'image/webp,*/*' };

    // First request: cache miss — should resolve auto → webp
    const res1 = await ctx.request(url, { headers: acceptHeader });
    expect(res1.status).toBe(200);
    expect(res1.headers.get('content-type')).toBe('image/webp');

    // Second request: cache hit — must still return image/webp, not image/jpeg
    const res2 = await ctx.request(url, { headers: acceptHeader });
    expect(res2.status).toBe(200);
    expect(res2.headers.get('content-type')).toBe('image/webp');
  });
});
