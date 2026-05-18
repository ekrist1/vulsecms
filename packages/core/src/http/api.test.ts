import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth, seedSuperUser } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { describe, expect, it } from 'vitest';
import { loadBlueprints } from '../blueprints/load.js';
import { createBlueprint } from '../blueprints/mutations.js';
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
import { createContentService } from '../content/service.js';
import { loadSets } from '../sets/load.js';
import { createApi } from './api.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'blueprints', '__fixtures__');

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
  const blueprints = await loadBlueprints({ adapter: db });
  const sets = await loadSets({ adapter: db });
  const content = createContentService(db, blueprints);
  const authInstance = createAuth({
    client: db.client,
    env: { authSecret: 'x', baseUrl: 'http://x', allowPublicSignup: true, smtpUrl: undefined },
  });
  const app = createApi({ blueprints, content, adapter: db, authInstance, sets });

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

  it('returns 409 when creating a second singleton entry', async () => {
    const { app, db, authInstance, cookie } = await setup(async (seedDb) => {
      await createBlueprint(seedDb, {
        handle: 'home-page',
        label: 'Home page',
        singleton: true,
        fields: [{ name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false }],
      });
    });

    const first = await app.request('http://x/api/collections/home-page', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Welcome' }),
    });
    expect(first.status).toBe(201);

    const second = await app.request('http://x/api/collections/home-page', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: 'Again' }),
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      error: 'conflict',
      message: 'This singleton collection already has an entry.',
    });

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

  it('returns 200 with filtered (unprotected) entries for anonymous access to collection list', async () => {
    const { app, db, authInstance } = await setup();
    const res = await app.request('http://x/api/collections/posts');
    // Anonymous reads are now allowed; protected entries are filtered out.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
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

  it('GET /api/auth/me returns perms for editor in a group', async () => {
    const { app, db, authInstance, cookie: superCookie } = await setup();

    const editorEmail = 'editor@x.com';
    const editorPassword = 'hunter2hunter2';

    // Create the editor user via the sign-up endpoint.
    const signup = await app.request('http://x/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: editorEmail, password: editorPassword, name: 'Editor' }),
    });
    expect(signup.status).toBe(200);

    // Promote to editor + add to a group with read perm on posts.
    await db.exec(`UPDATE users SET role = 'editor' WHERE email = ?`, [editorEmail]);
    const userRow = await db.queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [editorEmail]);

    // Ensure the posts collection row exists.
    await db.exec(
      `INSERT OR IGNORE INTO collections (handle, blueprint_hash, definition) VALUES ('posts', '', '{"handle":"posts","label":"Posts","singleton":false,"fields":[]}')`,
    );

    // Create a group with read permission on posts.
    const { ulid } = await import('ulid');
    const groupId = ulid();
    await db.exec(`INSERT INTO groups (id, handle, label) VALUES (?, 'editors', 'Editors')`, [groupId]);
    await db.exec(`INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)`, [userRow!.id, groupId]);
    await db.exec(
      `INSERT INTO group_permissions (group_id, collection_handle, can_read, can_create, can_update, can_delete) VALUES (?, 'posts', 1, 0, 0, 0)`,
      [groupId],
    );

    // Sign in as the editor.
    const signin = await app.request('http://x/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: editorEmail, password: editorPassword }),
    });
    const editorCookie = signin.headers.get('set-cookie') ?? '';

    // /api/auth/me should reflect the perm.
    const me = await app.request('http://x/api/auth/me', { headers: { cookie: editorCookie } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { user: { email: string; role: string }; perms: Record<string, string[]> };
    expect(body.user.email).toBe(editorEmail);
    expect(body.user.role).toBe('editor');
    expect(body.perms.posts).toEqual(['read']);

    // Super user gets the wildcard.
    const meSuper = await app.request('http://x/api/auth/me', { headers: { cookie: superCookie } });
    const superBody = (await meSuper.json()) as { perms: Record<string, string[]> };
    expect(superBody.perms['*']).toEqual(['read', 'create', 'update', 'delete']);

    // Unauthenticated returns null user and empty perms.
    const anon = await app.request('http://x/api/auth/me');
    expect(anon.status).toBe(200);
    const anonBody = (await anon.json()) as { user: null; perms: Record<string, never> };
    expect(anonBody.user).toBeNull();
    expect(anonBody.perms).toEqual({});

    authInstance.close();
    await db.close();
  });
});
