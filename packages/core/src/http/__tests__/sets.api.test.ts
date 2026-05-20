import { createAuth, seedSuperUser } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { toWebHandler } from 'h3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBlueprints } from '../../blueprints/load.js';
import { createContentService } from '../../content/service.js';
import { loadSets } from '../../sets/load.js';
import { createApi } from '../api.js';

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db, MIGRATIONS_DIR);
  const authInstance = createAuth({
    client: db.client,
    env: { authSecret: 's', baseUrl: 'http://x', allowPublicSignup: true, smtpUrl: undefined },
  });
  await seedSuperUser({
    adapter: db,
    bootstrapEmail: 'super@x.com',
    bootstrapPassword: 'hunter2hunter2',
    isProd: false,
  });
  const sets = await loadSets({ adapter: db });
  const blueprints = await loadBlueprints({ adapter: db, sets });
  const content = createContentService(db, blueprints);
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
  return { db, authInstance, app, cookie };
}

describe('/api/sets', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    ctx.authInstance.close();
  });

  const setBody = {
    handle: 'quote',
    label: 'Quote',
    fields: [{ name: 'q', ui: { kind: 'text' }, optional: false }],
  };

  it('anonymous GET /api/sets → 401', async () => {
    const res = await ctx.app.request('http://x/api/sets');
    expect(res.status).toBe(401);
  });

  it('anonymous POST /api/sets → 401', async () => {
    const res = await ctx.app.request('http://x/api/sets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(setBody),
    });
    expect(res.status).toBe(401);
  });

  it('super creates a set', async () => {
    const res = await ctx.app.request('http://x/api/sets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.cookie },
      body: JSON.stringify(setBody),
    });
    expect(res.status).toBe(201);
    const out = (await res.json()) as { handle: string };
    expect(out.handle).toBe('quote');
  });

  it('super updates and gets a set', async () => {
    await ctx.app.request('http://x/api/sets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.cookie },
      body: JSON.stringify(setBody),
    });
    const upd = await ctx.app.request('http://x/api/sets/quote', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: ctx.cookie },
      body: JSON.stringify({ ...setBody, label: 'Quote v2' }),
    });
    expect(upd.status).toBe(200);
    const got = await ctx.app.request('http://x/api/sets/quote', {
      headers: { cookie: ctx.cookie },
    });
    const body = (await got.json()) as { label: string };
    expect(body.label).toBe('Quote v2');
  });

  it('super deletes a set', async () => {
    await ctx.app.request('http://x/api/sets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ctx.cookie },
      body: JSON.stringify(setBody),
    });
    const del = await ctx.app.request('http://x/api/sets/quote', {
      method: 'DELETE',
      headers: { cookie: ctx.cookie },
    });
    expect(del.status).toBe(204);
    const got = await ctx.app.request('http://x/api/sets/quote', {
      headers: { cookie: ctx.cookie },
    });
    expect(got.status).toBe(404);
  });
});
