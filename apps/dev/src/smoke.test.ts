import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ViteDevServer, createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let server: ViteDevServer;
let base: string;

beforeAll(async () => {
  // Isolated in-memory DB so the smoke test never collides with a running
  // `pnpm dev` (which would otherwise hit SQLITE_READONLY_DBMOVED on writes).
  process.env.VULSE_DB_URL = ':memory:';
  server = await createServer({
    configFile: resolve(root, 'vite.config.ts'),
    root,
    server: { port: 0, host: '127.0.0.1' },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server?.close();
});

describe('apps/dev smoke', () => {
  it('serves /api/_meta/collections with both fixture blueprints', async () => {
    const res = await fetch(`${base}/api/_meta/collections`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handle: string }[];
    expect(body.map((b) => b.handle).sort()).toEqual(['authors', 'posts']);
  });

  it('round-trips a POST + GET against /api/collections/posts', async () => {
    const created = await fetch(`${base}/api/collections/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Hello',
        slug: 'hello',
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
        status: 'draft',
      }),
    });
    expect(created.status).toBe(201);
    const entry = (await created.json()) as { id: string };

    const got = await fetch(`${base}/api/collections/posts/${entry.id}`);
    expect(got.status).toBe(200);
    const back = (await got.json()) as { id: string; content: { title: string } };
    expect(back.id).toBe(entry.id);
    expect(back.content.title).toBe('Hello');
  });

  it('renames a field on a blueprint and reflects it in /api/_meta/collections', async () => {
    // Read the current Posts definition
    const getRes = await fetch(`${base}/api/blueprints/posts`);
    expect(getRes.status).toBe(200);
    const current = (await getRes.json()) as {
      handle: string;
      label: string;
      singleton: boolean;
      fields: { name: string; ui: { kind: string }; optional: boolean }[];
    };

    // Rename 'title' to 'headline' (preserve everything else)
    const renamed = {
      handle: current.handle,
      label: current.label,
      singleton: current.singleton,
      fields: current.fields.map((f) =>
        f.name === 'title' ? { ...f, name: 'headline', previousName: 'title' } : f,
      ),
    };
    const patchRes = await fetch(`${base}/api/blueprints/posts`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(renamed),
    });
    expect(patchRes.status).toBe(200);

    // The content meta must reflect the new field name on the next request.
    const metaRes = await fetch(`${base}/api/_meta/collections`);
    const meta = (await metaRes.json()) as { handle: string; fields: { name: string }[] }[];
    const posts = meta.find((m) => m.handle === 'posts')!;
    expect(posts.fields.map((f) => f.name)).toContain('headline');
    expect(posts.fields.map((f) => f.name)).not.toContain('title');

    // Posting content with the new field name succeeds.
    const created = await fetch(`${base}/api/collections/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        headline: 'After Rename',
        slug: 'after',
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
        status: 'draft',
      }),
    });
    expect(created.status).toBe(201);
  });
});
