import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { describe, expect, it } from 'vitest';
import { loadBlueprints } from '../blueprints/load.js';
import { createContentService } from '../content/service.js';
import { createApi } from './api.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'blueprints', '__fixtures__');

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  const blueprints = await loadBlueprints(fixturesDir, { adapter: db });
  const content = createContentService(db, blueprints);
  const app = createApi({ blueprints, content });
  return { db, app };
}

describe('createApi', () => {
  it('lists entries as a plain array', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/collections/posts');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    await db.close();
  });

  it('POST creates and GET retrieves an entry', async () => {
    const { app, db } = await setup();
    const created = await app.request('http://x/api/collections/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'hi', body: [] }),
    });
    expect(created.status).toBe(201);
    const entry = await created.json();
    const fetched = await app.request(`http://x/api/collections/posts/${entry.id}`);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toEqual(entry);
    await db.close();
  });

  it('returns 422 with issues on validation failure', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/collections/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '', body: [] }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('validation');
    expect(Array.isArray(body.issues)).toBe(true);
    await db.close();
  });

  it('returns 404 on missing entry', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/collections/posts/missing');
    expect(res.status).toBe(404);
    await db.close();
  });

  it('PATCH updates and DELETE removes', async () => {
    const { app, db } = await setup();
    const created = await (
      await app.request('http://x/api/collections/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'a', body: [] }),
      })
    ).json();
    const updated = await (
      await app.request(`http://x/api/collections/posts/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'b' }),
      })
    ).json();
    expect(updated.content.title).toBe('b');

    const del = await app.request(`http://x/api/collections/posts/${created.id}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);
    await db.close();
  });

  it('/api/_meta/collections returns blueprint metadata', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/_meta/collections');
    const meta = await res.json();
    const handles = meta.map((m: { handle: string }) => m.handle).sort();
    expect(handles).toEqual(['authors', 'posts']);
    const posts = meta.find((m: { handle: string }) => m.handle === 'posts');
    expect(posts.fields[0]).toMatchObject({ name: 'title', ui: { kind: 'text' } });
    await db.close();
  });
});
