import { createAuth, seedSuperUser } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { loadBlueprints } from '../../blueprints/load.js';
import { createContentService } from '../../content/service.js';
import { loadSets } from '../../sets/load.js';
import { createApi } from '../api.js';

describe('protected entries', () => {
  let app: ReturnType<typeof createApi>;
  let db: LibsqlAdapter;

  beforeEach(async () => {
    db = new LibsqlAdapter({ url: ':memory:' });
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db, MIGRATIONS_DIR);
    await db.exec(
      `INSERT INTO collections (handle, blueprint_hash, definition) VALUES ('posts', '', '{"handle":"posts","label":"Posts","singleton":false,"fields":[{"name":"title","label":"Title","ui":{"kind":"text"},"optional":false}]}')`,
    );
    const e1 = ulid(), e2 = ulid();
    await db.exec(`INSERT INTO entries (id, collection_handle, sort_order, status, protected, content) VALUES (?, 'posts', 1, 'published', 0, ?)`, [e1, JSON.stringify({ title: 'Public' })]);
    await db.exec(`INSERT INTO entries (id, collection_handle, sort_order, status, protected, content) VALUES (?, 'posts', 2, 'published', 1, ?)`, [e2, JSON.stringify({ title: 'Secret' })]);
    const authInstance = createAuth({ client: db.client, env: { authSecret: 's', baseUrl: 'http://x', allowPublicSignup: true, smtpUrl: undefined } });
    await seedSuperUser({ adapter: db, bootstrapEmail: 'admin@x.com', bootstrapPassword: 'hunter2hunter2', isProd: false });
    const sets = await loadSets({ adapter: db });
    const blueprints = await loadBlueprints({ adapter: db, sets });
    const content = createContentService(db, blueprints);
    app = createApi({ blueprints, content, adapter: db, authInstance, sets });
  });

  it('anonymous list filters out protected entries', async () => {
    const res = await app.request('http://x/api/collections/posts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { content: { title: string } }[] };
    expect(body.items.map((e) => e.content.title)).toEqual(['Public']);
  });

  it('anonymous single GET on protected entry returns 401', async () => {
    const rows = await db.query<{ id: string; protected: number }>('SELECT id, protected FROM entries WHERE collection_handle = ? ORDER BY sort_order', ['posts']);
    const protectedId = rows.find((r) => r.protected === 1)!.id;
    const res = await app.request(`http://x/api/collections/posts/${protectedId}`);
    expect(res.status).toBe(401);
  });

  it('anonymous single GET on unprotected entry returns 200', async () => {
    const rows = await db.query<{ id: string; protected: number }>('SELECT id, protected FROM entries WHERE collection_handle = ? ORDER BY sort_order', ['posts']);
    const publicId = rows.find((r) => r.protected === 0)!.id;
    const res = await app.request(`http://x/api/collections/posts/${publicId}`);
    expect(res.status).toBe(200);
  });

  it('signed-in super sees protected entry in list and single', async () => {
    const signin = await app.request('http://x/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@x.com', password: 'hunter2hunter2' }),
    });
    const cookie = signin.headers.get('set-cookie') ?? '';
    const list = await app.request('http://x/api/collections/posts', { headers: { cookie } });
    const body = (await list.json()) as { items: unknown[] };
    expect(body.items.length).toBe(2);
    const rows = await db.query<{ id: string; protected: number }>('SELECT id, protected FROM entries WHERE collection_handle = ? ORDER BY sort_order', ['posts']);
    const protectedId = rows.find((r) => r.protected === 1)!.id;
    const single = await app.request(`http://x/api/collections/posts/${protectedId}`, { headers: { cookie } });
    expect(single.status).toBe(200);
  });
});
