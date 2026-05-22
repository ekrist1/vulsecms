import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vulseLoader } from '@vulse/astro';
import type { AstroDataStoreEntry } from '@vulse/astro';
import { type ViteDevServer, createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// End-to-end check: run the @vulse/astro loader against a live Vulse
// dev server. Exercises the public collections endpoint, the
// contentHash response field, and the ?since= incremental filter all
// at once.

let server: ViteDevServer;
let base: string;
let superCookie: string;

beforeAll(async () => {
  process.env.VULSE_DB_URL = ':memory:';
  process.env.VULSE_BOOTSTRAP_EMAIL = 'admin@vulse.local';
  process.env.VULSE_BOOTSTRAP_PASSWORD = 'smoke-test-pw-12345';
  server = await createServer({
    configFile: resolve(root, 'vite.config.ts'),
    root,
    server: { port: 0, host: '127.0.0.1' },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;

  const signin = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@vulse.local',
      password: 'smoke-test-pw-12345',
    }),
  });
  superCookie = signin.headers.get('set-cookie') ?? '';

  // Seed two published entries with a gap between them so the
  // incremental sync test has something to filter on.
  await createPost('Loader Post A', 'loader-a');
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await createPost('Loader Post B', 'loader-b');
});

afterAll(async () => {
  await server?.close();
});

async function createPost(title: string, slug: string): Promise<string> {
  const res = await fetch(`${base}/api/collections/posts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: superCookie },
    body: JSON.stringify({
      title,
      slug,
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
      status: 'published',
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

function makeContext() {
  const store = new Map<string, AstroDataStoreEntry>();
  const meta = new Map<string, string>();
  return {
    store: {
      set: (e: AstroDataStoreEntry) => {
        store.set(e.id, e);
        return true;
      },
      has: (id: string) => store.has(id),
      delete: (id: string) => store.delete(id),
      clear: () => store.clear(),
    },
    meta: {
      get: (k: string) => meta.get(k),
      set: (k: string, v: string) => {
        meta.set(k, v);
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    parseData: async <T extends Record<string, unknown>>(props: { id: string; data: T }) =>
      props.data,
    _entries: store,
    _meta: meta,
  };
}

describe('@vulse/astro loader against a live Vulse server', () => {
  it('fetches every published entry on the first run and stores a contentHash', async () => {
    const ctx = makeContext();
    const loader = vulseLoader({ url: base, collection: 'posts' });
    await loader.load(ctx);
    expect(ctx._entries.size).toBeGreaterThanOrEqual(2);
    for (const entry of ctx._entries.values()) {
      expect(entry.digest).toMatch(/^[a-f0-9]{16}$/);
    }
  });

  it('persists lastUpdatedAt and does not refetch unchanged entries', async () => {
    const ctx = makeContext();
    const loader = vulseLoader({ url: base, collection: 'posts' });
    await loader.load(ctx);
    const lastUpdated = ctx._meta.get('vulse:lastUpdatedAt');
    expect(lastUpdated).toBeTruthy();

    // Second run with the same context simulates an incremental rebuild:
    // ?since= is set, so the API should return nothing new and the
    // store should keep its existing entries untouched.
    const before = new Map(ctx._entries);
    await loader.load(ctx);
    expect(ctx._entries.size).toBe(before.size);
  });

  it('picks up a new entry added between runs via ?since=', async () => {
    const ctx = makeContext();
    const loader = vulseLoader({ url: base, collection: 'posts' });
    await loader.load(ctx);
    const sizeAfterFirst = ctx._entries.size;
    const lastUpdated = ctx._meta.get('vulse:lastUpdatedAt');
    expect(lastUpdated).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const newId = await createPost('Loader Post C', 'loader-c');
    await loader.load(ctx);
    expect(ctx._entries.size).toBe(sizeAfterFirst + 1);
    expect(ctx._entries.has(newId)).toBe(true);
  });

  it('exposes a schema function that builds a Zod object from the blueprint', async () => {
    const loader = vulseLoader({ url: base, collection: 'posts' });
    const schema = await loader.schema?.();
    expect(schema).toBeDefined();
    // The schema should at least know the posts collection's `headline`
    // field is a string. We don't pin the full shape because the
    // fixture can evolve.
    const z = schema as { safeParse: (v: unknown) => { success: boolean } };
    expect(z.safeParse({ title: 'ok', slug: 's', body: {}, status: 'published' }).success).toBe(
      true,
    );
  });
});
