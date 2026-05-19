import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { toWebHandler } from 'h3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBlueprints } from '../blueprints/load.js';
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
import { createContentService } from '../content/service.js';
import { loadSets } from '../sets/load.js';
import { createApi } from './api.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'blueprints', '__fixtures__');

describe('public read API', () => {
  let db: LibsqlAdapter;
  let authInstance: ReturnType<typeof createAuth>;
  let app: { request: (url: string, init?: RequestInit) => Promise<Response> };
  let publicId: string;
  let protectedId: string;

  beforeEach(async () => {
    db = new LibsqlAdapter({ url: ':memory:' });
    await runMigrations(db, MIGRATIONS_DIR);
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });

    const sets = await loadSets({ adapter: db });
    const blueprints = await loadBlueprints({ adapter: db, sets });
    const content = createContentService(db, blueprints);
    const publicEntry = await content.create('posts', { title: 'Public post', body: [] });
    const protectedEntry = await content.create('posts', {
      title: 'Protected post',
      body: [],
      protected: true,
    });
    publicId = publicEntry.id;
    protectedId = protectedEntry.id;

    authInstance = createAuth({
      client: db.client,
      env: { authSecret: 'x', baseUrl: 'http://x', allowPublicSignup: true, smtpUrl: undefined },
    });
    const rawApp = createApi({ blueprints, content, adapter: db, authInstance, sets });
    const handler = toWebHandler(rawApp);
    app = {
      request: (url: string, init?: RequestInit) => handler(new Request(url, init)),
    };
  });

  afterEach(async () => {
    authInstance.close();
    await db.close();
  });

  it('lists only unprotected entries without a cookie', async () => {
    const res = await app.request('http://x/api/public/collections/posts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; content: { title: string } }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: publicId, content: { title: 'Public post' } });
  });

  it('returns an unprotected entry without a cookie', async () => {
    const res = await app.request(`http://x/api/public/collections/posts/${publicId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; protected: boolean };
    expect(body.id).toBe(publicId);
    expect(body.protected).toBe(false);
  });

  it('returns 404 for protected entries without a cookie', async () => {
    const res = await app.request(`http://x/api/public/collections/posts/${protectedId}`);
    expect(res.status).toBe(404);
  });

  it('returns public collection metadata without a cookie', async () => {
    const res = await app.request('http://x/api/public/_meta/collections');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handle: string; fields: { name: string }[] }[];
    expect(body.map((m) => m.handle).sort()).toEqual(['authors', 'drafts-posts', 'posts']);
    expect(body.find((m) => m.handle === 'posts')?.fields[0]).toMatchObject({
      name: 'title',
    });
  });
});
