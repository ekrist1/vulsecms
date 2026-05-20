import { createAuth, seedSuperUser } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { toWebHandler } from 'h3';
import { describe, expect, it } from 'vitest';
import { loadBlueprints } from '../blueprints/load.js';
import { createBlueprint } from '../blueprints/mutations.js';
import { createContentService } from '../content/service.js';
import { loadSets } from '../sets/load.js';
import { createApi } from './api.js';

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db, MIGRATIONS_DIR);
  await seedSuperUser({
    adapter: db,
    bootstrapEmail: 'super@x.com',
    bootstrapPassword: 'hunter2hunter2',
    isProd: false,
  });
  await createBlueprint(db, {
    handle: 'pages',
    label: 'Pages',
    singleton: false,
    tree: true,
    maxDepth: 4,
    fields: [{ name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false }],
  });

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
    previewSecret: 'test-preview-secret',
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

async function createPage(
  app: Awaited<ReturnType<typeof setup>>['app'],
  cookie: string,
  body: { title: string; parentId?: string | null },
): Promise<{ id: string; parentId: string | null; sortOrder: number }> {
  const res = await app.request('http://x/api/collections/pages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return await res.json();
}

describe('tree endpoints', () => {
  it('GET /api/collections/:handle?parent_id=root returns only root entries', async () => {
    const { app, db, authInstance, cookie } = await setup();
    const about = await createPage(app, cookie, { title: 'About' });
    await createPage(app, cookie, { title: 'Team', parentId: about.id });
    await createPage(app, cookie, { title: 'Ethics', parentId: about.id });
    await createPage(app, cookie, { title: 'Pricing' });

    const res = await app.request('http://x/api/collections/pages?parent_id=root', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { content: { title: string } }[]; total: number };
    expect(body.total).toBe(2);
    expect(body.items.map((e) => e.content.title)).toEqual(['About', 'Pricing']);

    authInstance.close();
    await db.close();
  });

  it("GET /api/collections/:handle?parent_id=<id> returns that parent's children", async () => {
    const { app, db, authInstance, cookie } = await setup();
    const about = await createPage(app, cookie, { title: 'About' });
    await createPage(app, cookie, { title: 'Team', parentId: about.id });
    await createPage(app, cookie, { title: 'Ethics', parentId: about.id });

    const res = await app.request(`http://x/api/collections/pages?parent_id=${about.id}`, {
      headers: { cookie },
    });
    const body = (await res.json()) as { items: { content: { title: string } }[] };
    expect(body.items.map((e) => e.content.title)).toEqual(['Team', 'Ethics']);

    authInstance.close();
    await db.close();
  });

  it('GET /api/collections/:handle/tree returns the nested structure', async () => {
    const { app, db, authInstance, cookie } = await setup();
    const about = await createPage(app, cookie, { title: 'About' });
    const team = await createPage(app, cookie, { title: 'Team', parentId: about.id });
    await createPage(app, cookie, { title: 'Alice', parentId: team.id });
    await createPage(app, cookie, { title: 'Ethics', parentId: about.id });

    const res = await app.request('http://x/api/collections/pages/tree', { headers: { cookie } });
    expect(res.status).toBe(200);
    const tree = (await res.json()) as Array<{
      content: { title: string };
      children: Array<{
        content: { title: string };
        children: Array<{ content: { title: string } }>;
      }>;
    }>;
    expect(tree.length).toBe(1);
    expect(tree[0]!.content.title).toBe('About');
    expect(tree[0]!.children.map((c) => c.content.title)).toEqual(['Team', 'Ethics']);
    expect(tree[0]!.children[0]!.children.map((c) => c.content.title)).toEqual(['Alice']);

    authInstance.close();
    await db.close();
  });

  it('PATCH /api/collections/:handle/:id/move reparents and reorders', async () => {
    const { app, db, authInstance, cookie } = await setup();
    const about = await createPage(app, cookie, { title: 'About' });
    const pricing = await createPage(app, cookie, { title: 'Pricing' });
    const team = await createPage(app, cookie, { title: 'Team', parentId: about.id });

    // Move Team to be Pricing's child at position 1.
    const res = await app.request(`http://x/api/collections/pages/${team.id}/move`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ parentId: pricing.id, sortOrder: 1 }),
    });
    expect(res.status).toBe(200);
    const moved = await res.json();
    expect(moved.parentId).toBe(pricing.id);
    expect(moved.sortOrder).toBe(1);

    authInstance.close();
    await db.close();
  });

  it('PATCH .../move requires parentId in body (use null for root)', async () => {
    const { app, db, authInstance, cookie } = await setup();
    const a = await createPage(app, cookie, { title: 'A' });
    const res = await app.request(`http://x/api/collections/pages/${a.id}/move`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    authInstance.close();
    await db.close();
  });

  it('PATCH .../move rejects cycles', async () => {
    const { app, db, authInstance, cookie } = await setup();
    const a = await createPage(app, cookie, { title: 'A' });
    const b = await createPage(app, cookie, { title: 'B', parentId: a.id });
    const res = await app.request(`http://x/api/collections/pages/${a.id}/move`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ parentId: b.id }),
    });
    expect(res.status).toBe(422);
    authInstance.close();
    await db.close();
  });

  it('public GET /api/public/collections/:handle/tree works without auth', async () => {
    const { app, db, authInstance, cookie } = await setup();
    const about = await createPage(app, cookie, { title: 'About' });
    await createPage(app, cookie, { title: 'Team', parentId: about.id });

    const res = await app.request('http://x/api/public/collections/pages/tree');
    expect(res.status).toBe(200);
    const tree = (await res.json()) as Array<{
      content: { title: string };
      children: Array<{ content: { title: string } }>;
    }>;
    expect(tree[0]!.content.title).toBe('About');
    expect(tree[0]!.children[0]!.content.title).toBe('Team');

    authInstance.close();
    await db.close();
  });

  it('returns tree info in /api/_meta/collections', async () => {
    const { app, db, authInstance, cookie } = await setup();
    const res = await app.request('http://x/api/_meta/collections', { headers: { cookie } });
    const meta = (await res.json()) as Array<{ handle: string; tree: boolean; maxDepth?: number }>;
    const pages = meta.find((m) => m.handle === 'pages');
    expect(pages?.tree).toBe(true);
    expect(pages?.maxDepth).toBe(4);

    authInstance.close();
    await db.close();
  });
});
