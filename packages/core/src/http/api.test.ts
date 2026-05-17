import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth, seedSuperUser } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { describe, expect, it } from 'vitest';
import { loadBlueprints } from '../blueprints/load.js';
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
import { createContentService } from '../content/service.js';
import { createApi } from './api.js';

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
  const blueprints = await loadBlueprints({ adapter: db });
  const content = createContentService(db, blueprints);
  const authInstance = createAuth({
    client: db.client,
    env: { authSecret: 'x', baseUrl: 'http://x', allowPublicSignup: true, smtpUrl: undefined },
  });
  const app = createApi({ blueprints, content, adapter: db, authInstance });

  const signin = await app.request('http://x/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'super@x.com', password: 'hunter2hunter2' }),
  });
  const cookie = signin.headers.get('set-cookie') ?? '';

  return { db, app, authInstance, cookie };
}

describe('createApi', () => {
  it('lists entries as a paginated result', async () => {
    const { app, db, authInstance, cookie } = await setup();
    const res = await app.request('http://x/api/collections/posts', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], total: 0, limit: 100, offset: 0 });
    authInstance.close();
    await db.close();
  });

  it('supports search and pagination query params', async () => {
    const { app, db, authInstance, cookie } = await setup();
    await app.request('http://x/api/collections/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Intro to libSQL', body: [] }),
    });
    await app.request('http://x/api/collections/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Hono routes 101', body: [] }),
    });

    const res = await app.request('http://x/api/collections/posts?q=libsql&limit=1&offset=0', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      total: 1,
      limit: 1,
      offset: 0,
      items: [{ content: { title: 'Intro to libSQL', body: [] } }],
    });
    authInstance.close();
    await db.close();
  });

  it('POST creates and GET retrieves an entry', async () => {
    const { app, db, authInstance, cookie } = await setup();
    const created = await app.request('http://x/api/collections/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'hi', body: [] }),
    });
    expect(created.status).toBe(201);
    const entry = await created.json();
    const fetched = await app.request(`http://x/api/collections/posts/${entry.id}`, {
      headers: { cookie },
    });
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toEqual(entry);
    authInstance.close();
    await db.close();
  });

  it('returns 422 with issues on validation failure', async () => {
    const { app, db, authInstance, cookie } = await setup();
    const res = await app.request('http://x/api/collections/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: '', body: [] }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('validation');
    expect(Array.isArray(body.issues)).toBe(true);
    authInstance.close();
    await db.close();
  });

  it('returns 404 on missing entry', async () => {
    const { app, db, authInstance, cookie } = await setup();
    const res = await app.request('http://x/api/collections/posts/missing', {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    authInstance.close();
    await db.close();
  });

  it('PATCH updates and DELETE removes', async () => {
    const { app, db, authInstance, cookie } = await setup();
    const created = await (
      await app.request('http://x/api/collections/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ title: 'a', body: [] }),
      })
    ).json();
    const updated = await (
      await app.request(`http://x/api/collections/posts/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ title: 'b' }),
      })
    ).json();
    expect(updated.content.title).toBe('b');

    const del = await app.request(`http://x/api/collections/posts/${created.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(del.status).toBe(204);
    authInstance.close();
    await db.close();
  });

  it('/api/_meta/collections returns blueprint metadata', async () => {
    const { app, db, authInstance, cookie } = await setup();
    const res = await app.request('http://x/api/_meta/collections', { headers: { cookie } });
    const meta = await res.json();
    const handles = meta.map((m: { handle: string }) => m.handle).sort();
    expect(handles).toEqual(['authors', 'posts']);
    const posts = meta.find((m: { handle: string }) => m.handle === 'posts');
    expect(posts.fields[0]).toMatchObject({ name: 'title', ui: { kind: 'text' } });
    authInstance.close();
    await db.close();
  });

  it('returns 401 on unauthenticated access to collection routes', async () => {
    const { app, db, authInstance } = await setup();
    const res = await app.request('http://x/api/collections/posts');
    expect(res.status).toBe(401);
    authInstance.close();
    await db.close();
  });

  it('returns 401 on unauthenticated access to _meta/collections', async () => {
    const { app, db, authInstance } = await setup();
    const res = await app.request('http://x/api/_meta/collections');
    expect(res.status).toBe(401);
    authInstance.close();
    await db.close();
  });
});
