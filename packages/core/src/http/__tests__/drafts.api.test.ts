import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth, seedSuperUser } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { toWebHandler } from 'h3';
import { describe, expect, it } from 'vitest';
import { loadBlueprints } from '../../blueprints/load.js';
import { seedBlueprintsFromCode } from '../../blueprints/seed.js';
import { createContentService } from '../../content/service.js';
import { loadSets } from '../../sets/load.js';
import { createApi } from '../api.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', 'blueprints', '__fixtures__');

async function setup(seed?: (db: LibsqlAdapter) => Promise<void>) {
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
  const rawApp = createApi({ blueprints, content, adapter: db, authInstance, sets });
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
