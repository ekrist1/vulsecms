import type { Blueprint, ContentService, Entry } from '@vulse/core';
import { describe, expect, it } from 'vitest';
import { resolveSiteRequest } from './render.js';

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

describe('resolveSiteRequest', () => {
  it('resolves collection slug routes to public entries', async () => {
    const result = await resolveSiteRequest(
      { blueprints, content: content as ContentService },
      new URL('http://x/posts/hello'),
    );
    expect(result.status).toBe(200);
    expect(result.state.entry?.id).toBe('public');
  });

  it('does not resolve protected entries without preview', async () => {
    const result = await resolveSiteRequest(
      { blueprints, content: content as ContentService },
      new URL('http://x/posts/secret'),
    );
    expect(result.status).toBe(404);
  });

  it('resolves protected entries in preview mode', async () => {
    const result = await resolveSiteRequest(
      { blueprints, content: content as ContentService },
      new URL('http://x/posts/secret?preview=1'),
    );
    expect(result.status).toBe(200);
    expect(result.state.entry?.id).toBe('secret');
  });
});
