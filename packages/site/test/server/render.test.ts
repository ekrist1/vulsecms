import type { AuthInstance } from '@vulse/auth';
import type { Blueprint, ContentService, Entry, FieldFilter } from '@vulse/core';
import { describe, expect, it } from 'vitest';
import { resolveSiteRequest } from '../../src/server/middleware/render.js';

function entry(id: string, collection: string, slug: string, protectedEntry = false): Entry {
  return {
    id,
    collection,
    parentId: null,
    sortOrder: 1,
    status: 'published',
    protected: protectedEntry,
    content: { title: id, slug, body: [] },
    createdAt: '',
    updatedAt: '',
  };
}

const publicPost = entry('public', 'posts', 'hello');
const protectedPost = entry('secret', 'posts', 'secret', true);

const content: Pick<ContentService, 'list' | 'get'> = {
  async list(handle, opts) {
    const items = [publicPost, protectedPost].filter((item) => {
      if (item.collection !== handle) return false;
      if (item.protected && !opts?.includeProtected) return false;
      if (opts?.field === 'slug' && opts.q) return item.content.slug === opts.q;
      return true;
    });
    return { items, total: items.length, limit: opts?.limit ?? 25, offset: opts?.offset ?? 0 };
  },
  async get(handle, id) {
    return (
      [publicPost, protectedPost].find((item) => item.collection === handle && item.id === id) ??
      null
    );
  },
};

const blueprints = new Map<string, Blueprint>([
  [
    'posts',
    {
      handle: 'posts',
      label: 'Posts',
      singleton: false,
      fields: [],
      hash: '',
      schema: {} as never,
    },
  ],
]);

/**
 * Build a mock AuthInstance whose getSession returns the given user shape.
 * We use `as unknown as AuthInstance` because we only need the narrow
 * `auth.api.getSession` surface that resolvePreview calls. No real DB needed.
 */
function mockAuth(user: { role: string; isSuper: boolean | number } | null): AuthInstance {
  return {
    auth: {
      api: {
        getSession: async (_opts: unknown) => (user ? { user } : null),
      },
    },
  } as unknown as AuthInstance;
}

const deps = { blueprints, content: content as ContentService };

describe('resolveSiteRequest', () => {
  it('resolves collection slug routes to public entries', async () => {
    const result = await resolveSiteRequest(deps, new URL('http://x/posts/hello'));
    expect(result.status).toBe(200);
    expect(result.state.entry?.id).toBe('public');
  });

  it('serializes public globals into every resolved site state', async () => {
    const globals = {
      publicValues: async () => ({ site: { siteName: 'Vulse' } }),
    };
    const result = await resolveSiteRequest(
      { ...deps, globals: globals as never },
      new URL('http://x/posts/hello'),
    );
    expect(result.state.globals).toEqual({ site: { siteName: 'Vulse' } });
  });

  it('does not resolve protected entries without preview', async () => {
    const result = await resolveSiteRequest(deps, new URL('http://x/posts/secret'));
    expect(result.status).toBe(404);
  });

  // --- Gate tests: ?preview=1 is only honoured for editors/supers ---

  it('ignores ?preview=1 when no authInstance is provided (safe default)', async () => {
    // deps has no authInstance — anonymous visitors cannot bypass protection
    const result = await resolveSiteRequest(deps, new URL('http://x/posts/secret?preview=1'));
    expect(result.status).toBe(404);
  });

  it('ignores ?preview=1 when authInstance is present but there is no session cookie', async () => {
    // getSession returns null → not signed in
    const depsWithAuth = { ...deps, authInstance: mockAuth(null) };
    const result = await resolveSiteRequest(
      depsWithAuth,
      new URL('http://x/posts/secret?preview=1'),
      new Headers(), // no cookie header
    );
    expect(result.status).toBe(404);
  });

  it('ignores ?preview=1 for a signed-in external_user (not an editorial role)', async () => {
    const depsWithAuth = {
      ...deps,
      authInstance: mockAuth({ role: 'external_user', isSuper: false }),
    };
    const headers = new Headers({ cookie: 'vulse_session=fake-external-token' });
    const result = await resolveSiteRequest(
      depsWithAuth,
      new URL('http://x/posts/secret?preview=1'),
      headers,
    );
    expect(result.status).toBe(404);
  });

  it('honours ?preview=1 for a signed-in editor', async () => {
    const depsWithAuth = {
      ...deps,
      authInstance: mockAuth({ role: 'editor', isSuper: false }),
    };
    const headers = new Headers({ cookie: 'vulse_session=fake-editor-token' });
    const result = await resolveSiteRequest(
      depsWithAuth,
      new URL('http://x/posts/secret?preview=1'),
      headers,
    );
    expect(result.status).toBe(200);
    expect(result.state.entry?.id).toBe('secret');
  });

  it('honours ?preview=1 for a super user (any role)', async () => {
    const depsWithAuth = {
      ...deps,
      authInstance: mockAuth({ role: 'external_user', isSuper: true }),
    };
    const headers = new Headers({ cookie: 'vulse_session=fake-super-token' });
    const result = await resolveSiteRequest(
      depsWithAuth,
      new URL('http://x/posts/secret?preview=1'),
      headers,
    );
    expect(result.status).toBe(200);
    expect(result.state.entry?.id).toBe('secret');
  });

  it('resolveSiteRequest with a route override + filter returns only matching entries', async () => {
    const postA: Entry = {
      id: 'a',
      collection: 'posts',
      parentId: null,
      sortOrder: 1,
      status: 'published',
      protected: false,
      content: { title: 'A', slug: 'a', status: 'published' },
      createdAt: '',
      updatedAt: '',
    };
    const postB: Entry = {
      id: 'b',
      collection: 'posts',
      parentId: null,
      sortOrder: 2,
      status: 'published',
      protected: false,
      content: { title: 'B', slug: 'b', status: 'draft' },
      createdAt: '',
      updatedAt: '',
    };

    const filterableContent: Pick<ContentService, 'list' | 'get'> = {
      async list(handle, opts) {
        let items = [postA, postB].filter((item) => item.collection === handle);
        if (opts?.filter) {
          for (const [field, spec] of Object.entries(opts.filter as Record<string, FieldFilter>)) {
            if ('eq' in spec && spec.eq !== undefined) {
              const val = spec.eq;
              items = items.filter(
                (item) => (item.content as Record<string, unknown>)[field] === val,
              );
            }
          }
        }
        return { items, total: items.length, limit: opts?.limit ?? 25, offset: opts?.offset ?? 0 };
      },
      async get(handle, id) {
        return [postA, postB].find((item) => item.collection === handle && item.id === id) ?? null;
      },
    };

    const filterDeps = {
      blueprints,
      content: filterableContent as ContentService,
      routes: {
        '/blog': {
          collection: 'posts',
          list: true,
          filter: { status: { eq: 'published' } },
        },
      },
    };

    const { status, state } = await resolveSiteRequest(filterDeps, new URL('http://x/blog'));
    expect(status).toBe(200);
    expect(state.route.type).toBe('list');
    expect(state.entries.map((e) => (e.content as { title: string }).title)).toEqual(['A']);
  });

  it('prefers site.routes over legacy top-level routes', async () => {
    const postA: Entry = {
      id: 'a',
      collection: 'posts',
      parentId: null,
      sortOrder: 1,
      status: 'published',
      protected: false,
      content: { title: 'A', slug: 'a', status: 'published' },
      draftContent: null,
      hasUnpublishedChanges: false,
      publishedAt: null,
      publishedBy: null,
      createdAt: '',
      updatedAt: '',
    };
    const postB: Entry = {
      id: 'b',
      collection: 'posts',
      parentId: null,
      sortOrder: 2,
      status: 'published',
      protected: false,
      content: { title: 'B', slug: 'b', status: 'draft' },
      draftContent: null,
      hasUnpublishedChanges: false,
      publishedAt: null,
      publishedBy: null,
      createdAt: '',
      updatedAt: '',
    };
    const filterableContent: Pick<ContentService, 'list' | 'get'> = {
      async list(handle, opts) {
        let items = [postA, postB].filter((item) => item.collection === handle);
        if (opts?.filter) {
          for (const [field, spec] of Object.entries(opts.filter as Record<string, FieldFilter>)) {
            if ('eq' in spec && spec.eq !== undefined) {
              items = items.filter(
                (item) => (item.content as Record<string, unknown>)[field] === spec.eq,
              );
            }
          }
        }
        return { items, total: items.length, limit: opts?.limit ?? 25, offset: opts?.offset ?? 0 };
      },
      async get(handle, id) {
        return [postA, postB].find((item) => item.collection === handle && item.id === id) ?? null;
      },
    };

    const { state } = await resolveSiteRequest(
      {
        blueprints,
        content: filterableContent as ContentService,
        routes: {
          '/blog': {
            collection: 'posts',
            list: true,
            filter: { status: { eq: 'draft' } },
          },
        },
        site: {
          routes: {
            '/blog': {
              collection: 'posts',
              list: true,
              filter: { status: { eq: 'published' } },
            },
          },
        },
      },
      new URL('http://x/blog'),
    );

    expect(state.entries.map((e) => (e.content as { title: string }).title)).toEqual(['A']);
  });

  it('draft-status entry 404s on the public site', async () => {
    const draftEntry: Entry = {
      id: 'd1',
      collection: 'posts',
      parentId: null,
      sortOrder: 1,
      status: 'draft',
      protected: false,
      content: { title: 'D', slug: 'd', body: [] },
      createdAt: '',
      updatedAt: '',
    };
    const draftContent: Pick<ContentService, 'list' | 'get'> = {
      async list(handle) {
        const items = handle === 'posts' ? [draftEntry] : [];
        return { items, total: items.length, limit: 25, offset: 0 };
      },
      async get() {
        return draftEntry;
      },
    };
    const draftDeps = { blueprints, content: draftContent as ContentService };
    const { status } = await resolveSiteRequest(draftDeps, new URL('http://x/posts/d'));
    expect(status).toBe(404);
  });

  // --- Preview token tests: ?vulse-preview=<token> swaps draftContent for content ---

  it('valid preview token swaps draft_content in for the targeted entry', async () => {
    const { signPreviewToken } = await import('@vulse/core');
    const secret = 'test-preview-secret';
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signPreviewToken({ entryId: 'd1', userId: 'u1', exp }, secret);

    const previewableEntry: Entry = {
      id: 'd1',
      collection: 'posts',
      parentId: null,
      sortOrder: 1,
      status: 'published',
      protected: false,
      content: { title: 'live', slug: 'd', body: [] },
      draftContent: { title: 'draft-version', slug: 'd', body: [] },
      hasUnpublishedChanges: true,
      publishedAt: '2026-01-01T00:00:00Z',
      publishedBy: 'u1',
      createdAt: '',
      updatedAt: '',
    };
    const deps = {
      blueprints,
      previewSecret: secret,
      content: {
        list: async () => ({ items: [previewableEntry], total: 1, limit: 25, offset: 0 }),
        get: async () => previewableEntry,
      },
    } as unknown as ReturnType<() => typeof deps>;

    const { state } = await resolveSiteRequest(
      deps,
      new URL(`http://x/posts/d?vulse-preview=${token}`),
    );
    expect(state.entry?.content).toEqual({ title: 'draft-version', slug: 'd', body: [] });
  });

  it('expired preview token falls back to published rendering', async () => {
    const { signPreviewToken } = await import('@vulse/core');
    const secret = 'test-preview-secret';
    const exp = Math.floor(Date.now() / 1000) - 60;
    const token = signPreviewToken({ entryId: 'd1', userId: 'u1', exp }, secret);

    const previewableEntry: Entry = {
      id: 'd1',
      collection: 'posts',
      parentId: null,
      sortOrder: 1,
      status: 'published',
      protected: false,
      content: { title: 'live', slug: 'd', body: [] },
      draftContent: { title: 'draft-version', slug: 'd', body: [] },
      hasUnpublishedChanges: true,
      publishedAt: '2026-01-01T00:00:00Z',
      publishedBy: 'u1',
      createdAt: '',
      updatedAt: '',
    };
    const deps = {
      blueprints,
      previewSecret: secret,
      content: {
        list: async () => ({ items: [previewableEntry], total: 1, limit: 25, offset: 0 }),
        get: async () => previewableEntry,
      },
    } as unknown as ReturnType<() => typeof deps>;

    const { state } = await resolveSiteRequest(
      deps,
      new URL(`http://x/posts/d?vulse-preview=${token}`),
    );
    // Expired token → fall back to live content.
    expect(state.entry?.content).toEqual({ title: 'live', slug: 'd', body: [] });
  });

  it('preview token can surface a status=draft entry (otherwise 404)', async () => {
    const { signPreviewToken } = await import('@vulse/core');
    const secret = 'test-preview-secret';
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signPreviewToken({ entryId: 'd2', userId: 'u1', exp }, secret);

    const draftEntry: Entry = {
      id: 'd2',
      collection: 'posts',
      parentId: null,
      sortOrder: 1,
      status: 'draft',
      protected: false,
      content: {},
      draftContent: { title: 'preview-only', slug: 'd2', body: [] },
      hasUnpublishedChanges: true,
      publishedAt: null,
      publishedBy: null,
      createdAt: '',
      updatedAt: '',
    };
    const deps = {
      blueprints,
      previewSecret: secret,
      content: {
        list: async () => ({ items: [], total: 0, limit: 25, offset: 0 }), // mimics published filter
        get: async () => draftEntry,
      },
    } as unknown as ReturnType<() => typeof deps>;

    const { status, state } = await resolveSiteRequest(
      deps,
      new URL(`http://x/posts/d2?vulse-preview=${token}`),
    );
    expect(status).toBe(200);
    expect(state.entry?.content).toEqual({ title: 'preview-only', slug: 'd2', body: [] });
  });
});
