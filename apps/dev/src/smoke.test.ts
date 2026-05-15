import { existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ViteDevServer, createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let server: ViteDevServer;
let base: string;

beforeAll(async () => {
  const devDb = resolve(root, 'dev.db');
  if (existsSync(devDb)) unlinkSync(devDb);
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
        body: [],
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
});
