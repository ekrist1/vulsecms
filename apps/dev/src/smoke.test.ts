import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ViteDevServer, createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let server: ViteDevServer;
let base: string;
let superCookie: string;

beforeAll(async () => {
  // Isolated in-memory DB so the smoke test never collides with a running
  // `pnpm dev` (which would otherwise hit SQLITE_READONLY_DBMOVED on writes).
  process.env.VULSE_DB_URL = ':memory:';
  // Provide known bootstrap credentials so we can sign in during the test.
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

  // Sign in as the bootstrap super user so collection/blueprint routes pass auth.
  const signin = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@vulse.local',
      password: 'smoke-test-pw-12345',
    }),
  });
  superCookie = signin.headers.get('set-cookie') ?? '';
});

afterAll(async () => {
  await server?.close();
});

describe('apps/dev smoke', () => {
  it('serves /api/_meta/collections with both fixture blueprints', async () => {
    const res = await fetch(`${base}/api/_meta/collections`, {
      headers: { cookie: superCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handle: string }[];
    expect(body.map((b) => b.handle).sort()).toEqual(['authors', 'pages', 'posts']);
  });

  it('round-trips a POST + GET against /api/collections/posts', async () => {
    const created = await fetch(`${base}/api/collections/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superCookie },
      body: JSON.stringify({
        title: 'Hello',
        slug: 'hello',
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
        status: 'draft',
      }),
    });
    expect(created.status).toBe(201);
    const entry = (await created.json()) as { id: string };

    const got = await fetch(`${base}/api/collections/posts/${entry.id}`, {
      headers: { cookie: superCookie },
    });
    expect(got.status).toBe(200);
    const back = (await got.json()) as { id: string; content: { title: string } };
    expect(back.id).toBe(entry.id);
    expect(back.content.title).toBe('Hello');
  });

  it('serves the public read API without a cookie', async () => {
    const slug = `public-${Date.now()}`;
    const created = await fetch(`${base}/api/collections/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superCookie },
      body: JSON.stringify({
        title: 'Public API post',
        headline: 'Public API post',
        slug,
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
        status: 'draft',
      }),
    });
    expect(created.status).toBe(201);
    const entry = (await created.json()) as { id: string };

    const list = await fetch(`${base}/api/public/collections/posts`);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: { id: string }[] };
    expect(body.items.find((item) => item.id === entry.id)).toBeDefined();
  });

  it('renames a field on a blueprint and reflects it in /api/_meta/collections', async () => {
    // Read the current Posts definition
    const getRes = await fetch(`${base}/api/blueprints/posts`, {
      headers: { cookie: superCookie },
    });
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
      headers: { 'content-type': 'application/json', cookie: superCookie },
      body: JSON.stringify(renamed),
    });
    expect(patchRes.status).toBe(200);

    // The content meta must reflect the new field name on the next request.
    const metaRes = await fetch(`${base}/api/_meta/collections`, {
      headers: { cookie: superCookie },
    });
    const meta = (await metaRes.json()) as { handle: string; fields: { name: string }[] }[];
    const posts = meta.find((m) => m.handle === 'posts')!;
    expect(posts.fields.map((f) => f.name)).toContain('headline');
    expect(posts.fields.map((f) => f.name)).not.toContain('title');

    // Posting content with the new field name succeeds.
    const created = await fetch(`${base}/api/collections/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superCookie },
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

describe('auth Phase A', () => {
  it('signs up an external user and signs them in', async () => {
    const email = `u-${Date.now()}@example.com`;
    const password = 'hunter2hunter2';

    // Sign up.
    const signup = await fetch(`${base}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, name: 'Tester' }),
    });
    expect(signup.status).toBe(200);

    // Sign in.
    const signin = await fetch(`${base}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(signin.status).toBe(200);
    const cookie = signin.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('vulse_session=');

    // /api/auth/me reflects the signed-in user.
    const meRes = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
    expect(meRes.status).toBe(200);
    const me = (await meRes.json()) as { user: { email: string; role: string } | null };
    expect(me.user?.email).toBe(email);
    expect(me.user?.role).toBe('external_user');

    // Sign out.
    const signout = await fetch(`${base}/api/auth/sign-out`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(signout.status).toBe(200);
  });
});

describe('protected entries', () => {
  it('anonymous cannot read a protected entry; signed-in can', async () => {
    // Create a protected entry as super.
    const created = await fetch(`${base}/api/collections/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superCookie },
      body: JSON.stringify({
        headline: 'Secret',
        slug: 'secret',
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
        status: 'draft',
        protected: true,
      }),
    });
    expect(created.status).toBe(201);
    const entry = (await created.json()) as { id: string; protected: boolean };
    expect(entry.protected).toBe(true);

    // Anonymous: 401.
    const anonRes = await fetch(`${base}/api/collections/posts/${entry.id}`);
    expect(anonRes.status).toBe(401);

    // Signed-in: 200.
    const authedRes = await fetch(`${base}/api/collections/posts/${entry.id}`, {
      headers: { cookie: superCookie },
    });
    expect(authedRes.status).toBe(200);
    const body = (await authedRes.json()) as { protected: boolean; content: { headline: string } };
    expect(body.protected).toBe(true);
    expect(body.content.headline).toBe('Secret');

    // Anonymous list omits the protected entry.
    const listRes = await fetch(`${base}/api/collections/posts`);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { items: { id: string }[] };
    expect(list.items.find((e) => e.id === entry.id)).toBeUndefined();

    // Signed-in list includes it.
    const authedListRes = await fetch(`${base}/api/collections/posts`, {
      headers: { cookie: superCookie },
    });
    const authedList = (await authedListRes.json()) as { items: { id: string }[] };
    expect(authedList.items.find((e) => e.id === entry.id)).toBeDefined();
  });
});

describe('bard sets', () => {
  const setBody = {
    handle: 'qquote',
    label: 'Quote',
    fields: [
      { name: 'quote', ui: { kind: 'text' }, optional: false },
      { name: 'author', ui: { kind: 'text' }, optional: false },
    ],
  };

  let postsBlueprint: { handle: string; label: string; singleton: boolean; fields: unknown[] };

  it('creates a set as super', async () => {
    const res = await fetch(`${base}/api/sets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superCookie },
      body: JSON.stringify(setBody),
    });
    expect(res.status).toBe(201);
  });

  it('adds the set to the Posts body field', async () => {
    const getBp = await fetch(`${base}/api/blueprints/posts`, { headers: { cookie: superCookie } });
    postsBlueprint = (await getBp.json()) as typeof postsBlueprint;
    const updated = {
      ...postsBlueprint,
      fields: postsBlueprint.fields.map((f) => {
        const field = f as { name: string; ui: { kind: string } };
        if (field.name === 'body' && field.ui.kind === 'blocks') {
          return { ...field, ui: { kind: 'blocks', sets: ['qquote'] } };
        }
        return f;
      }),
    };
    const patch = await fetch(`${base}/api/blueprints/posts`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: superCookie },
      body: JSON.stringify(updated),
    });
    expect(patch.status).toBe(200);
  });

  it('POSTs an entry with a valid vulseSet node', async () => {
    const created = await fetch(`${base}/api/collections/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superCookie },
      body: JSON.stringify({
        headline: 'Hello',
        slug: 'hello-bard',
        body: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] },
            {
              type: 'vulseSet',
              attrs: { set: 'qquote', data: { quote: 'Be brave', author: 'Anna' } },
            },
          ],
        },
        status: 'draft',
      }),
    });
    if (created.status !== 201) {
      const text = await created.text();
      throw new Error(`Expected 201 but got ${created.status}: ${text}`);
    }
    const entry = (await created.json()) as {
      id: string;
      content: { body: { content: unknown[] } };
    };

    const got = await fetch(`${base}/api/collections/posts/${entry.id}`, {
      headers: { cookie: superCookie },
    });
    const body = (await got.json()) as { content: { body: { content: unknown[] } } };
    const setNode = (
      body.content.body.content as Array<{ type: string; attrs?: Record<string, unknown> }>
    ).find((n) => n.type === 'vulseSet');
    expect(setNode).toBeDefined();
    expect((setNode!.attrs!.data as { author: string }).author).toBe('Anna');
  });

  it('rejects an entry with missing required set field', async () => {
    const res = await fetch(`${base}/api/collections/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superCookie },
      body: JSON.stringify({
        headline: 'Bad',
        slug: 'bad-bard',
        body: {
          type: 'doc',
          content: [{ type: 'vulseSet', attrs: { set: 'qquote', data: { quote: 'half' } } }],
        },
        status: 'draft',
      }),
    });
    expect(res.status).toBe(422);
    const out = (await res.json()) as { issues?: { path: (string | number)[] }[] };
    const issuePaths = (out.issues ?? []).map((i) => (i.path ?? []).join('.'));
    expect(issuePaths.some((p) => p.includes('data.author'))).toBe(true);
  });

  it('rejects an entry referencing an unknown set', async () => {
    const res = await fetch(`${base}/api/collections/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superCookie },
      body: JSON.stringify({
        headline: 'Bad',
        slug: 'bad-bard-2',
        body: {
          type: 'doc',
          content: [{ type: 'vulseSet', attrs: { set: 'ghost', data: {} } }],
        },
        status: 'draft',
      }),
    });
    expect(res.status).toBe(422);
  });
});
