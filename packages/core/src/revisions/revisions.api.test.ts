import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth, seedSuperUser } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { toWebHandler } from 'h3';
import { describe, expect, it } from 'vitest';
import { loadBlueprints } from '../blueprints/load.js';
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
import { createContentService } from '../content/service.js';
import { createApi } from '../http/api.js';
import { loadSets } from '../sets/load.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'blueprints', '__fixtures__');

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
  await seedSuperUser({
    adapter: db,
    bootstrapEmail: 'super@x.com',
    bootstrapPassword: 'hunter2hunter2',
    isProd: false,
  });
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

async function createEntry(
  app: Awaited<ReturnType<typeof setup>>['app'],
  cookie: string,
  body: object,
) {
  const res = await app.request('http://x/api/collections/posts', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return res.json();
}

describe('revisions API', () => {
  it('creates an initial revision when an entry is created', async () => {
    const { app, authInstance, cookie } = await setup();
    const entry = await createEntry(app, cookie, {
      title: 'v1',
      slug: 'v1',
      status: 'draft',
      body: {},
    });
    const res = await app.request(`http://x/api/collections/posts/${entry.id}/revisions`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].revisionNumber).toBe(1);
    expect(body.items[0].createdBy).toBeTruthy();
    authInstance.close();
  });

  it('appends a revision per update with monotonically increasing numbers', async () => {
    const { app, authInstance, cookie } = await setup();
    const entry = await createEntry(app, cookie, {
      title: 'v1',
      slug: 'v1',
      status: 'draft',
      body: {},
    });
    for (const title of ['v2', 'v3']) {
      const res = await app.request(`http://x/api/collections/posts/${entry.id}`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      expect(res.status).toBe(200);
    }
    const list = await app.request(`http://x/api/collections/posts/${entry.id}/revisions`, {
      headers: { cookie },
    });
    const body = await list.json();
    expect(body.total).toBe(3);
    expect(body.items.map((r: { revisionNumber: number }) => r.revisionNumber)).toEqual([3, 2, 1]);
    authInstance.close();
  });

  it('fetches a single revision with its full content', async () => {
    const { app, authInstance, cookie } = await setup();
    const entry = await createEntry(app, cookie, {
      title: 'original',
      slug: 'o',
      status: 'draft',
      body: {},
    });
    await app.request(`http://x/api/collections/posts/${entry.id}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'changed' }),
    });
    const list = await app.request(`http://x/api/collections/posts/${entry.id}/revisions`, {
      headers: { cookie },
    });
    const items = (await list.json()).items as Array<{ id: string; revisionNumber: number }>;
    const first = items.find((r) => r.revisionNumber === 1)!;
    const detail = await app.request(
      `http://x/api/collections/posts/${entry.id}/revisions/${first.id}`,
      {
        headers: { cookie },
      },
    );
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.content.title).toBe('original');
    authInstance.close();
  });

  it('restores a revision by applying its content as the new current state', async () => {
    const { app, authInstance, cookie } = await setup();
    const entry = await createEntry(app, cookie, {
      title: 'original',
      slug: 'o',
      status: 'draft',
      body: {},
    });
    await app.request(`http://x/api/collections/posts/${entry.id}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'changed' }),
    });
    const list = await app.request(`http://x/api/collections/posts/${entry.id}/revisions`, {
      headers: { cookie },
    });
    const items = (await list.json()).items as Array<{ id: string; revisionNumber: number }>;
    const original = items.find((r) => r.revisionNumber === 1)!;
    const restore = await app.request(
      `http://x/api/collections/posts/${entry.id}/revisions/${original.id}/restore`,
      { method: 'POST', headers: { cookie } },
    );
    expect(restore.status).toBe(200);
    const restored = await restore.json();
    expect(restored.content.title).toBe('original');

    const after = await app.request(`http://x/api/collections/posts/${entry.id}/revisions`, {
      headers: { cookie },
    });
    expect((await after.json()).total).toBe(3); // create + update + restore
    authInstance.close();
  });

  it('rejects unauthenticated revision reads', async () => {
    const { app, authInstance, cookie } = await setup();
    const entry = await createEntry(app, cookie, {
      title: 'v1',
      slug: 'v1',
      status: 'draft',
      body: {},
    });
    const res = await app.request(`http://x/api/collections/posts/${entry.id}/revisions`);
    expect(res.status).toBe(401);
    authInstance.close();
  });

  it('returns 404 for revisions of an unknown entry', async () => {
    const { app, authInstance, cookie } = await setup();
    const res = await app.request('http://x/api/collections/posts/missing/revisions', {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    authInstance.close();
  });
});
