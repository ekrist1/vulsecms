import { createAuth, seedSuperUser } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { toWebHandler } from 'h3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContentService } from '../content/service.js';
import { createGlobalService } from '../globals/service.js';
import { createApi } from './api.js';

describe('globals API', () => {
  let db: LibsqlAdapter;
  let authInstance: ReturnType<typeof createAuth>;
  let cookie: string;
  let app: { request: (url: string, init?: RequestInit) => Promise<Response> };

  beforeEach(async () => {
    db = new LibsqlAdapter({ url: ':memory:' });
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db, MIGRATIONS_DIR);
    await seedSuperUser({
      adapter: db,
      bootstrapEmail: 'super@x.com',
      bootstrapPassword: 'hunter2hunter2',
      isProd: false,
    });

    const blueprints = new Map();
    const content = createContentService(db, blueprints);
    const globals = createGlobalService(db, new Map());
    authInstance = createAuth({
      client: db.client,
      env: { authSecret: 'x', baseUrl: 'http://x', allowPublicSignup: true, smtpUrl: undefined },
    });
    const rawApp = createApi({
      blueprints,
      content,
      adapter: db,
      authInstance,
      previewSecret: 'test-preview-secret',
      globals,
    });
    const handler = toWebHandler(rawApp);
    app = {
      request: (url: string, init?: RequestInit) => handler(new Request(url, init)),
    };

    const signin = await app.request('http://x/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'super@x.com', password: 'hunter2hunter2' }),
    });
    cookie = signin.headers.get('set-cookie') ?? '';
  });

  afterEach(async () => {
    authInstance.close();
    await db.close();
  });

  async function createSiteGlobals() {
    const res = await app.request('http://x/api/globals', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        handle: 'site',
        label: 'Site',
        fields: [
          { name: 'siteName', ui: { kind: 'text' }, optional: false },
          { name: 'tagline', ui: { kind: 'textarea' }, optional: true },
        ],
      }),
    });
    expect(res.status).toBe(201);
  }

  it('creates, lists, and reads global sets for authenticated users', async () => {
    await createSiteGlobals();

    const list = await app.request('http://x/api/globals', { headers: { cookie } });
    expect(list.status).toBe(200);
    const sets = (await list.json()) as Array<{ handle: string; label: string; fields: unknown[] }>;
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ handle: 'site', label: 'Site' });
    expect(sets[0]?.fields).toHaveLength(2);

    const single = await app.request('http://x/api/globals/site', { headers: { cookie } });
    expect(single.status).toBe(200);
    expect(await single.json()).toMatchObject({
      set: { handle: 'site', label: 'Site' },
      value: { handle: 'site', content: {} },
    });
  });

  it('stores validated global content and exposes it publicly', async () => {
    await createSiteGlobals();

    const updated = await app.request('http://x/api/globals/site/value', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ siteName: 'Vulse', tagline: 'Content everywhere' }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      handle: 'site',
      content: { siteName: 'Vulse', tagline: 'Content everywhere' },
    });

    const publicAll = await app.request('http://x/api/public/globals');
    expect(publicAll.status).toBe(200);
    expect(await publicAll.json()).toEqual({
      site: { siteName: 'Vulse', tagline: 'Content everywhere' },
    });

    const publicSingle = await app.request('http://x/api/public/globals/site');
    expect(publicSingle.status).toBe(200);
    expect(await publicSingle.json()).toEqual({
      siteName: 'Vulse',
      tagline: 'Content everywhere',
    });
  });

  it('requires super access for writes and auth for admin reads', async () => {
    const list = await app.request('http://x/api/globals');
    expect(list.status).toBe(401);

    const create = await app.request('http://x/api/globals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'site',
        label: 'Site',
        fields: [{ name: 'siteName', ui: { kind: 'text' }, optional: false }],
      }),
    });
    expect(create.status).toBe(401);
  });

  it('returns 422 for invalid global content and 404 for missing public sets', async () => {
    await createSiteGlobals();

    const invalid = await app.request('http://x/api/globals/site/value', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ siteName: 123 }),
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ error: 'validation' });

    const missing = await app.request('http://x/api/public/globals/missing');
    expect(missing.status).toBe(404);
  });
});
