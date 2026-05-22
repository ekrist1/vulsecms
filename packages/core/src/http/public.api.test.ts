import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { toWebHandler } from 'h3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBlueprints } from '../blueprints/load.js';
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
import { createContentService } from '../content/service.js';
import { signPreviewToken } from '../preview/preview-token.js';
import { loadSets } from '../sets/load.js';
import { createApi } from './api.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'blueprints', '__fixtures__');

describe('public read API', () => {
  let db: LibsqlAdapter;
  let authInstance: ReturnType<typeof createAuth>;
  let app: { request: (url: string, init?: RequestInit) => Promise<Response> };
  let publicId: string;
  let protectedId: string;

  beforeEach(async () => {
    db = new LibsqlAdapter({ url: ':memory:' });
    await runMigrations(db, MIGRATIONS_DIR);
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });

    const sets = await loadSets({ adapter: db });
    const blueprints = await loadBlueprints({ adapter: db, sets });
    const content = createContentService(db, blueprints);
    const publicEntry = await content.create('posts', { title: 'Public post', body: [] });
    const protectedEntry = await content.create('posts', {
      title: 'Protected post',
      body: [],
      protected: true,
    });
    publicId = publicEntry.id;
    protectedId = protectedEntry.id;

    authInstance = createAuth({
      client: db.client,
      env: { authSecret: 'x', baseUrl: 'http://x', allowPublicSignup: true, smtpUrl: undefined },
    });
    const rawApp = createApi({
      blueprints,
      content,
      adapter: db,
      authInstance,
      sets,
      previewSecret: 'test-preview-secret',
    });
    const handler = toWebHandler(rawApp);
    app = {
      request: (url: string, init?: RequestInit) => handler(new Request(url, init)),
    };
  });

  afterEach(async () => {
    authInstance.close();
    await db.close();
  });

  it('lists only unprotected entries without a cookie', async () => {
    const res = await app.request('http://x/api/public/collections/posts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; content: { title: string } }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: publicId, content: { title: 'Public post' } });
  });

  it('returns an unprotected entry without a cookie', async () => {
    const res = await app.request(`http://x/api/public/collections/posts/${publicId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; protected: boolean };
    expect(body.id).toBe(publicId);
    expect(body.protected).toBe(false);
  });

  it('returns 404 for protected entries without a cookie', async () => {
    const res = await app.request(`http://x/api/public/collections/posts/${protectedId}`);
    expect(res.status).toBe(404);
  });

  it('returns public collection metadata without a cookie', async () => {
    const res = await app.request('http://x/api/public/_meta/collections');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handle: string; fields: { name: string }[] }[];
    expect(body.map((m) => m.handle).sort()).toEqual(['authors', 'drafts-posts', 'posts']);
    expect(body.find((m) => m.handle === 'posts')?.fields[0]).toMatchObject({
      name: 'title',
    });
  });

  it('includes a stable contentHash on every entry', async () => {
    const res = await app.request('http://x/api/public/collections/posts');
    const body = (await res.json()) as { items: { id: string; contentHash: string }[] };
    expect(body.items[0]?.contentHash).toMatch(/^[a-f0-9]{16}$/);

    // Repeating the call yields the same hash (digest is stable for unchanged content).
    const res2 = await app.request('http://x/api/public/collections/posts');
    const body2 = (await res2.json()) as { items: { contentHash: string }[] };
    expect(body2.items[0]?.contentHash).toBe(body.items[0]?.contentHash);
  });
});

describe('public read API — incremental sync (?since=)', () => {
  let db: LibsqlAdapter;
  let authInstance: ReturnType<typeof createAuth>;
  let app: { request: (url: string, init?: RequestInit) => Promise<Response> };
  let firstId: string;
  let secondId: string;
  let timestampBetween: string;

  beforeEach(async () => {
    db = new LibsqlAdapter({ url: ':memory:' });
    await runMigrations(db, MIGRATIONS_DIR);
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });

    const sets = await loadSets({ adapter: db });
    const blueprints = await loadBlueprints({ adapter: db, sets });
    const content = createContentService(db, blueprints);

    const first = await content.create('posts', { title: 'First', body: [] });
    firstId = first.id;
    // Wait long enough for SQLite's `datetime('now')` (second precision) to
    // tick over so the WHERE updated_at > ? comparison can split the two
    // entries.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    timestampBetween = new Date().toISOString();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await content.create('posts', { title: 'Second', body: [] });
    secondId = second.id;

    authInstance = createAuth({
      client: db.client,
      env: { authSecret: 'x', baseUrl: 'http://x', allowPublicSignup: true, smtpUrl: undefined },
    });
    const rawApp = createApi({
      blueprints,
      content,
      adapter: db,
      authInstance,
      sets,
      previewSecret: 'test-preview-secret',
    });
    const handler = toWebHandler(rawApp);
    app = {
      request: (url: string, init?: RequestInit) => handler(new Request(url, init)),
    };
  });

  afterEach(async () => {
    authInstance.close();
    await db.close();
  });

  it('returns only entries updated after the given timestamp', async () => {
    const res = await app.request(
      `http://x/api/public/collections/posts?since=${encodeURIComponent(timestampBetween)}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[]; total: number };
    expect(body.items.map((i) => i.id)).toEqual([secondId]);
    expect(body.total).toBe(1);
  });

  it('returns the full collection when since= is omitted', async () => {
    const res = await app.request('http://x/api/public/collections/posts');
    const body = (await res.json()) as { items: { id: string }[]; total: number };
    expect(body.items.map((i) => i.id).sort()).toEqual([firstId, secondId].sort());
    expect(body.total).toBe(2);
  });
});

describe('public single-entry preview tokens', () => {
  let db: LibsqlAdapter;
  let authInstance: ReturnType<typeof createAuth>;
  let app: { request: (url: string, init?: RequestInit) => Promise<Response> };
  let draftId: string;
  const previewSecret = 'test-preview-secret';

  beforeEach(async () => {
    db = new LibsqlAdapter({ url: ':memory:' });
    await runMigrations(db, MIGRATIONS_DIR);
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });

    const sets = await loadSets({ adapter: db });
    const blueprints = await loadBlueprints({ adapter: db, sets });
    const content = createContentService(db, blueprints);

    // drafts-posts is the drafts-enabled fixture.
    const draft = await content.create(
      'drafts-posts',
      { title: 'Hidden', slug: 'hidden' },
      undefined,
      { publish: false },
    );
    draftId = draft.id;
    expect(draft.status).toBe('draft');

    authInstance = createAuth({
      client: db.client,
      env: { authSecret: 'x', baseUrl: 'http://x', allowPublicSignup: true, smtpUrl: undefined },
    });
    const rawApp = createApi({
      blueprints,
      content,
      adapter: db,
      authInstance,
      sets,
      previewSecret,
    });
    const handler = toWebHandler(rawApp);
    app = {
      request: (url: string, init?: RequestInit) => handler(new Request(url, init)),
    };
  });

  afterEach(async () => {
    authInstance.close();
    await db.close();
  });

  it('hides draft entries from the public single-entry endpoint by default', async () => {
    const res = await app.request(`http://x/api/public/collections/drafts-posts/${draftId}`);
    expect(res.status).toBe(404);
  });

  it('returns the draft content when a valid preview token is supplied', async () => {
    const token = signPreviewToken(
      { entryId: draftId, userId: 'tester', exp: Math.floor(Date.now() / 1000) + 60 },
      previewSecret,
    );
    const res = await app.request(
      `http://x/api/public/collections/drafts-posts/${draftId}?preview=${token}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; content: { title: string } };
    expect(body.id).toBe(draftId);
    expect(body.content.title).toBe('Hidden');
  });

  it('rejects a token signed for a different entry', async () => {
    const token = signPreviewToken(
      { entryId: 'some-other-id', userId: 'tester', exp: Math.floor(Date.now() / 1000) + 60 },
      previewSecret,
    );
    const res = await app.request(
      `http://x/api/public/collections/drafts-posts/${draftId}?preview=${token}`,
    );
    expect(res.status).toBe(401);
  });

  it('rejects a token with a tampered signature', async () => {
    const token = signPreviewToken(
      { entryId: draftId, userId: 'tester', exp: Math.floor(Date.now() / 1000) + 60 },
      previewSecret,
    );
    const tampered = `${token.slice(0, -4)}AAAA`;
    const res = await app.request(
      `http://x/api/public/collections/drafts-posts/${draftId}?preview=${tampered}`,
    );
    expect(res.status).toBe(401);
  });
});
