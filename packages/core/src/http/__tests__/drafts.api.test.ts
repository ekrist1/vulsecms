import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth, seedSuperUser } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { toWebHandler } from 'h3';
import { describe, expect, it } from 'vitest';
import { verifyPreviewToken } from '../../preview/preview-token.js';
import { loadBlueprints } from '../../blueprints/load.js';
import { seedBlueprintsFromCode } from '../../blueprints/seed.js';
import { createContentService } from '../../content/service.js';
import { loadSets } from '../../sets/load.js';
import { createApi } from '../api.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', 'blueprints', '__fixtures__');

async function setup(
  seed?: (db: LibsqlAdapter) => Promise<void>,
  previewSecret?: string,
) {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
  await seedSuperUser({
    adapter: db,
    bootstrapEmail: 'super@x.com',
    bootstrapPassword: 'hunter2hunter2',
    isProd: false,
  });
  if (seed) await seed(db);
  const sets = await loadSets({ adapter: db });
  const blueprints = await loadBlueprints({ adapter: db, sets });
  const content = createContentService(db, blueprints);
  const authInstance = createAuth({
    client: db.client,
    env: { authSecret: 'x', baseUrl: 'http://x', allowPublicSignup: true, smtpUrl: undefined },
  });
  const rawApp = createApi({
    blueprints,
    content,
    adapter: db,
    authInstance,
    sets,
    previewSecret: previewSecret ?? 'test-preview-secret',
  });
  const handler = toWebHandler(rawApp);
  const app = {
    request: (url: string, init?: RequestInit) => handler(new Request(url, init)),
  };

  const signin = await app.request('http://x/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'super@x.com', password: 'hunter2hunter2' }),
  });
  const cookie = signin.headers.get('set-cookie') ?? '';

  return { db, app, authInstance, cookie };
}

describe('POST /api/collections/:handle with publish flag', () => {
  it('accepts publish:false and creates draft entry', async () => {
    const { app, db, authInstance, cookie } = await setup();

    const res = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Draft Title', slug: 'draft-slug', publish: false }),
    });

    expect(res.status).toBe(201);
    const entry = (await res.json()) as Record<string, unknown>;
    expect(entry.status).toBe('draft');
    expect(entry.content).toEqual({});
    expect(entry.draftContent).toEqual({ title: 'Draft Title', slug: 'draft-slug' });

    authInstance.close();
    await db.close();
  });

  it('defaults to publishing when publish flag omitted', async () => {
    const { app, db, authInstance, cookie } = await setup();

    const res = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Published Title', slug: 'published-slug' }),
    });

    expect(res.status).toBe(201);
    const entry = (await res.json()) as Record<string, unknown>;
    expect(entry.status).toBe('published');
    expect(entry.content).toEqual({ title: 'Published Title', slug: 'published-slug' });
    expect(entry.draftContent).toBeNull();

    authInstance.close();
    await db.close();
  });

  it('accepts publish:true and publishes entry', async () => {
    const { app, db, authInstance, cookie } = await setup();

    const res = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Explicit Publish', slug: 'explicit-slug', publish: true }),
    });

    expect(res.status).toBe(201);
    const entry = (await res.json()) as Record<string, unknown>;
    expect(entry.status).toBe('published');
    expect(entry.content).toEqual({ title: 'Explicit Publish', slug: 'explicit-slug' });
    expect(entry.draftContent).toBeNull();

    authInstance.close();
    await db.close();
  });
});

describe('PATCH /api/collections/:handle/:id with publish flag', () => {
  it('defaults to draft when publish flag omitted', async () => {
    const { app, db, authInstance, cookie } = await setup();

    // Create a published entry
    const createRes = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Original', slug: 'original-slug', publish: true }),
    });
    const { id } = (await createRes.json()) as { id: string };

    // Update without publish flag - should save as draft
    const updateRes = await app.request(`http://x/api/collections/drafts-posts/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Updated Title', slug: 'updated-slug' }),
    });

    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as Record<string, unknown>;
    expect(updated.status).toBe('published');
    expect(updated.content).toEqual({ title: 'Original', slug: 'original-slug' });
    expect(updated.draftContent).toEqual({ title: 'Updated Title', slug: 'updated-slug' });

    authInstance.close();
    await db.close();
  });

  it('accepts publish:true to promote draft to published', async () => {
    const { app, db, authInstance, cookie } = await setup();

    // Create a draft entry
    const createRes = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Draft Title', slug: 'draft-slug', publish: false }),
    });
    const { id } = (await createRes.json()) as { id: string };

    // Update with publish:true - should publish
    const updateRes = await app.request(`http://x/api/collections/drafts-posts/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Updated Title', slug: 'updated-slug', publish: true }),
    });

    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as Record<string, unknown>;
    expect(updated.status).toBe('published');
    expect(updated.content).toEqual({ title: 'Updated Title', slug: 'updated-slug' });
    expect(updated.draftContent).toBeNull();

    authInstance.close();
    await db.close();
  });

  it('accepts publish:false to save as draft', async () => {
    const { app, db, authInstance, cookie } = await setup();

    // Create a published entry
    const createRes = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Published', slug: 'published-slug', publish: true }),
    });
    const { id } = (await createRes.json()) as { id: string };

    // Update with publish:false - should save as draft
    const updateRes = await app.request(`http://x/api/collections/drafts-posts/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Updated Draft', slug: 'draft-slug', publish: false }),
    });

    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as Record<string, unknown>;
    expect(updated.status).toBe('published');
    expect(updated.content).toEqual({ title: 'Published', slug: 'published-slug' });
    expect(updated.draftContent).toEqual({ title: 'Updated Draft', slug: 'draft-slug' });

    authInstance.close();
    await db.close();
  });
});

describe('POST /:id/publish', () => {
  it('promotes the draft and returns 200 with published entry', async () => {
    const { app, db, authInstance, cookie } = await setup();

    // Create entry with publish:false (draft)
    const createRes = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Draft Title', slug: 'draft-slug', publish: false }),
    });
    const { id } = (await createRes.json()) as { id: string };

    // POST /publish
    const publishRes = await app.request(`http://x/api/collections/drafts-posts/${id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
    });

    expect(publishRes.status).toBe(200);
    const published = (await publishRes.json()) as Record<string, unknown>;
    expect(published.status).toBe('published');
    expect(published.content).toEqual({ title: 'Draft Title', slug: 'draft-slug' });
    expect(published.draftContent).toBeNull();

    authInstance.close();
    await db.close();
  });

  it('returns 401 when unauthenticated', async () => {
    const { app, db, authInstance, cookie } = await setup();

    // Create entry as super-user
    const createRes = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Draft Title', slug: 'draft-slug', publish: false }),
    });
    const { id } = (await createRes.json()) as { id: string };

    // POST /publish without cookie
    const publishRes = await app.request(`http://x/api/collections/drafts-posts/${id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    expect(publishRes.status).toBe(401);

    authInstance.close();
    await db.close();
  });
});

describe('POST /:id/unpublish', () => {
  it('demotes a published entry to draft and returns 200', async () => {
    const { app, db, authInstance, cookie } = await setup();

    // Create published entry
    const createRes = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Published Title', slug: 'published-slug', publish: true }),
    });
    const { id } = (await createRes.json()) as { id: string };

    // POST /unpublish
    const unpublishRes = await app.request(`http://x/api/collections/drafts-posts/${id}/unpublish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
    });

    expect(unpublishRes.status).toBe(200);
    const unpublished = (await unpublishRes.json()) as Record<string, unknown>;
    expect(unpublished.status).toBe('draft');
    expect(unpublished.draftContent).toEqual({ title: 'Published Title', slug: 'published-slug' });

    authInstance.close();
    await db.close();
  });
});

describe('DELETE /:id/draft', () => {
  it('clears the draft and returns the entry with draftContent=null', async () => {
    const { app, db, authInstance, cookie } = await setup();

    // Create published entry
    const createRes = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Published', slug: 'published-slug', publish: true }),
    });
    const { id } = (await createRes.json()) as { id: string };

    // Update with publish:false to create a draft
    await app.request(`http://x/api/collections/drafts-posts/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Draft Update', slug: 'draft-update' }),
    });

    // DELETE /draft
    const discardRes = await app.request(`http://x/api/collections/drafts-posts/${id}/draft`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', cookie },
    });

    expect(discardRes.status).toBe(200);
    const discarded = (await discardRes.json()) as Record<string, unknown>;
    expect(discarded.status).toBe('published');
    expect(discarded.content).toEqual({ title: 'Published', slug: 'published-slug' });
    expect(discarded.draftContent).toBeNull();

    authInstance.close();
    await db.close();
  });
});

describe('GET /api/collections/:handle?includeDrafts=1', () => {
  it('hides drafts by default for admin GET', async () => {
    const { app, db, authInstance, cookie } = await setup();

    // Create a draft entry
    const createRes = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Draft Title', slug: 'draft-slug', publish: false }),
    });
    expect(createRes.status).toBe(201);

    // GET /api/collections/drafts-posts without includeDrafts
    const listRes = await app.request('http://x/api/collections/drafts-posts', {
      headers: { cookie },
    });

    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Record<string, unknown>;
    const items = list.items as unknown[];
    expect(items).toHaveLength(0);

    authInstance.close();
    await db.close();
  });

  it('returns drafts when includeDrafts=1', async () => {
    const { app, db, authInstance, cookie } = await setup();

    // Create a draft entry
    const createRes = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Draft Title', slug: 'draft-slug', publish: false }),
    });
    expect(createRes.status).toBe(201);
    const entry = (await createRes.json()) as { id: string; status: string };
    expect(entry.status).toBe('draft');

    // GET /api/collections/drafts-posts?includeDrafts=1
    const listRes = await app.request('http://x/api/collections/drafts-posts?includeDrafts=1', {
      headers: { cookie },
    });

    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Record<string, unknown>;
    const items = list.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('draft');

    authInstance.close();
    await db.close();
  });

  it('returns 200 with empty items for unrelated requests', async () => {
    const { app, db, authInstance, cookie } = await setup();

    // GET /api/collections/drafts-posts with no entries
    const listRes = await app.request('http://x/api/collections/drafts-posts', {
      headers: { cookie },
    });

    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Record<string, unknown>;
    const items = list.items as unknown[];
    expect(items).toHaveLength(0);

    authInstance.close();
    await db.close();
  });
});

describe('POST /:id/preview-token', () => {
  it('returns a verifiable token for an entry the caller can read', async () => {
    const previewSecret = 'test-preview-secret';
    const { app, db, authInstance, cookie } = await setup(undefined, previewSecret);

    // Create entry with publish:false → draft
    const createRes = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Draft Title', slug: 'draft-slug', publish: false }),
    });
    expect(createRes.status).toBe(201);
    const entry = (await createRes.json()) as { id: string; status: string };
    expect(entry.status).toBe('draft');
    const { id } = entry;

    // POST /preview-token as super-user
    const tokenRes = await app.request(
      `http://x/api/collections/drafts-posts/${id}/preview-token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
      },
    );

    expect(tokenRes.status).toBe(200);
    const tokenBody = (await tokenRes.json()) as {
      token: string;
      expiresAt: string;
    };
    expect(tokenBody.token).toMatch(/^vp_/);
    expect(typeof tokenBody.expiresAt).toBe('string');

    // Verify token is verifiable
    const verified = verifyPreviewToken(tokenBody.token, previewSecret);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.entryId).toBe(id);
      expect(typeof verified.payload.userId).toBe('string');
      expect(typeof verified.payload.exp).toBe('number');
    }

    authInstance.close();
    await db.close();
  });

  it('returns 401 when called without auth', async () => {
    const { app, db, authInstance, cookie } = await setup();

    // Create entry as super-user
    const createRes = await app.request('http://x/api/collections/drafts-posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Draft Title', slug: 'draft-slug', publish: false }),
    });
    expect(createRes.status).toBe(201);
    const entry = (await createRes.json()) as { id: string };
    const { id } = entry;

    // POST /preview-token without cookie
    const tokenRes = await app.request(
      `http://x/api/collections/drafts-posts/${id}/preview-token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      },
    );

    expect(tokenRes.status).toBe(401);

    authInstance.close();
    await db.close();
  });
});
