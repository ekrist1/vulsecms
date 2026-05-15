import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const blueprints = await loadBlueprints({ adapter: db });
  const content = createContentService(db, blueprints);
  const app = createApi({ blueprints, content, adapter: db });
  return { db, app };
}

describe('blueprints API', () => {
  it('lists seeded blueprints', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/blueprints');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handle: string }[];
    expect(body.map((b) => b.handle).sort()).toEqual(['authors', 'posts']);
    await db.close();
  });

  it('GET /api/blueprints/:handle returns the definition', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/blueprints/posts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handle: string; fields: { name: string }[] };
    expect(body.handle).toBe('posts');
    expect(body.fields.find((f) => f.name === 'title')).toBeDefined();
    await db.close();
  });

  it('GET /api/blueprints/:handle returns 404 for unknown handle', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/blueprints/ghost');
    expect(res.status).toBe(404);
    await db.close();
  });

  it('POST creates a new blueprint', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/blueprints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'pages',
        label: 'Pages',
        singleton: false,
        fields: [{ name: 'title', ui: { kind: 'text' }, optional: false }],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { handle: string };
    expect(body.handle).toBe('pages');
    await db.close();
  });

  it('POST returns 422 on validation failure', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/blueprints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'Bad Handle',
        label: 'X',
        singleton: false,
        fields: [{ name: 'x', ui: { kind: 'text' }, optional: false }],
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('validation');
    await db.close();
  });

  it('PATCH updates a blueprint and applies a rename', async () => {
    const { app, db } = await setup();
    await db.exec(
      'INSERT INTO entries (id, collection_handle, content) VALUES (\'e1\', \'posts\', \'{"title":"Hello","body":[]}\')',
    );
    const res = await app.request('http://x/api/blueprints/posts', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle: 'posts',
        label: 'Articles',
        singleton: false,
        fields: [
          { name: 'headline', previousName: 'title', ui: { kind: 'text' }, optional: false },
          { name: 'body', ui: { kind: 'blocks' }, optional: false },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const row = await db.queryOne<{ content: string }>(
      "SELECT content FROM entries WHERE id = 'e1'",
    );
    expect(JSON.parse(row!.content).headline).toBe('Hello');
    await db.close();
  });

  it('DELETE removes a blueprint', async () => {
    const { app, db } = await setup();
    const res = await app.request('http://x/api/blueprints/authors', { method: 'DELETE' });
    expect(res.status).toBe(204);
    await db.close();
  });
});
