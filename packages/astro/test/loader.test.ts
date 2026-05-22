import { describe, expect, it, vi } from 'vitest';
import { vulseLoader } from '../src/loader.js';
import type {
  AstroDataStore,
  AstroDataStoreEntry,
  AstroLoaderContext,
  AstroMetaStore,
  VulseEntry,
} from '../src/types.js';

function makeStore(): AstroDataStore & { entries: Map<string, AstroDataStoreEntry> } {
  const entries = new Map<string, AstroDataStoreEntry>();
  return {
    entries,
    set(entry) {
      entries.set(entry.id, entry);
      return true;
    },
    has(id) {
      return entries.has(id);
    },
    delete(id) {
      return entries.delete(id);
    },
    clear() {
      entries.clear();
    },
  };
}

function makeMeta(): AstroMetaStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get(k) {
      return values.get(k);
    },
    set(k, v) {
      values.set(k, v);
    },
  };
}

function makeContext(overrides: Partial<AstroLoaderContext> = {}): AstroLoaderContext & {
  store: ReturnType<typeof makeStore>;
  meta: ReturnType<typeof makeMeta>;
} {
  const store = makeStore();
  const meta = makeMeta();
  return {
    store,
    meta,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    parseData: async ({ data }) => data,
    ...overrides,
  };
}

function makeEntry(id: string, content: Record<string, unknown>, updatedAt: string): VulseEntry {
  return {
    id,
    collection: 'posts',
    parentId: null,
    sortOrder: 1,
    status: 'published',
    protected: false,
    content,
    contentHash: `hash-${id}`,
    publishedAt: updatedAt,
    createdAt: updatedAt,
    updatedAt,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('vulseLoader', () => {
  it('fetches the collection and stores each entry with its content hash', async () => {
    const entries = [
      makeEntry('01HX1', { title: 'A' }, '2026-01-01T10:00:00Z'),
      makeEntry('01HX2', { title: 'B' }, '2026-01-02T10:00:00Z'),
    ];
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ items: entries, total: entries.length, limit: 200, offset: 0 }),
    );

    const loader = vulseLoader({
      url: 'http://vulse.test',
      collection: 'posts',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    const ctx = makeContext();
    await loader.load(ctx);

    expect(ctx.store.entries.size).toBe(2);
    expect(ctx.store.entries.get('01HX1')).toMatchObject({
      id: '01HX1',
      data: { title: 'A' },
      digest: 'hash-01HX1',
    });
    expect(ctx.store.entries.get('01HX2')?.digest).toBe('hash-01HX2');
  });

  it('records the highest updatedAt for incremental sync', async () => {
    const entries = [
      makeEntry('01HX1', { title: 'A' }, '2026-01-01T10:00:00Z'),
      makeEntry('01HX2', { title: 'B' }, '2026-01-05T10:00:00Z'),
      makeEntry('01HX3', { title: 'C' }, '2026-01-03T10:00:00Z'),
    ];
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ items: entries, total: entries.length, limit: 200, offset: 0 }),
    );

    const loader = vulseLoader({
      url: 'http://vulse.test',
      collection: 'posts',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const ctx = makeContext();
    await loader.load(ctx);

    expect(ctx.meta.values.get('vulse:lastUpdatedAt')).toBe('2026-01-05T10:00:00Z');
  });

  it('passes ?since= on subsequent runs using the stored timestamp', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      return jsonResponse({ items: [], total: 0, limit: 200, offset: 0 });
    });

    const loader = vulseLoader({
      url: 'http://vulse.test',
      collection: 'posts',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const ctx = makeContext();
    ctx.meta.set('vulse:lastUpdatedAt', '2026-01-04T00:00:00Z');
    await loader.load(ctx);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('since=2026-01-04');
  });

  it('paginates through multiple pages and stops when total is reached', async () => {
    const all = Array.from({ length: 5 }, (_, i) =>
      makeEntry(`01HX${i}`, { title: `t${i}` }, '2026-01-01T10:00:00Z'),
    );
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const limit = Number(url.searchParams.get('limit') ?? '200');
      return jsonResponse({
        items: all.slice(offset, offset + limit),
        total: all.length,
        limit,
        offset,
      });
    });

    const loader = vulseLoader({
      url: 'http://vulse.test',
      collection: 'posts',
      pageSize: 2,
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const ctx = makeContext();
    await loader.load(ctx);

    expect(ctx.store.entries.size).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // pages of 2 + 2 + 1
  });

  it('overlays preview content on top of the published sync', async () => {
    const published = makeEntry('01HX1', { title: 'Published' }, '2026-01-01T10:00:00Z');
    const draft: VulseEntry = {
      ...published,
      content: { title: 'Draft' },
      contentHash: 'hash-draft',
      status: 'draft',
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.pathname.endsWith('/01HX1')) return jsonResponse(draft);
      return jsonResponse({ items: [published], total: 1, limit: 200, offset: 0 });
    });

    const loader = vulseLoader({
      url: 'http://vulse.test',
      collection: 'posts',
      preview: { token: 'vp_xyz.sig', entryId: '01HX1' },
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const ctx = makeContext();
    await loader.load(ctx);

    expect(ctx.store.entries.get('01HX1')).toMatchObject({
      data: { title: 'Draft' },
      digest: 'hash-draft',
    });
  });

  it('skips preview overlay (without crashing) when the token is rejected', async () => {
    const published = makeEntry('01HX1', { title: 'Published' }, '2026-01-01T10:00:00Z');
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (url.pathname.endsWith('/01HX1')) {
        return new Response('{"error":"invalid_preview_token"}', { status: 401 });
      }
      return jsonResponse({ items: [published], total: 1, limit: 200, offset: 0 });
    });

    let warnedWith = '';
    const loader = vulseLoader({
      url: 'http://vulse.test',
      collection: 'posts',
      preview: { token: 'vp_bad.sig', entryId: '01HX1' },
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const ctx = makeContext({
      logger: {
        info: () => {},
        warn: (m) => {
          warnedWith = m;
        },
        error: () => {},
      },
    });
    await loader.load(ctx);

    expect(ctx.store.entries.get('01HX1')?.data).toEqual({ title: 'Published' });
    expect(warnedWith).toContain('preview token rejected');
  });

  it('throws when the Vulse server returns a non-OK status', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }));
    const loader = vulseLoader({
      url: 'http://vulse.test',
      collection: 'posts',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await expect(loader.load(makeContext())).rejects.toThrow(/500/);
  });
});
