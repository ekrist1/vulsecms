import type { Entry } from '@vulse/core';
import { describe, expect, it } from 'vitest';
import { resolveHead } from './head.js';
import type { SiteInitialState } from './types.js';

function entry(content: Record<string, unknown>): Entry {
  return {
    id: 'entry-1',
    collection: 'posts',
    parentId: null,
    sortOrder: 1,
    status: 'published',
    protected: false,
    content,
    draftContent: null,
    hasUnpublishedChanges: false,
    publishedAt: null,
    publishedBy: null,
    createdAt: '',
    updatedAt: '',
  };
}

function state(
  content: Record<string, unknown>,
  route: SiteInitialState['route'] = { type: 'entry', collection: 'posts', slug: 'hello' },
): SiteInitialState {
  return {
    route,
    blueprints: [],
    globals: {},
    entry: route.type === 'entry' ? entry(content) : null,
    entries: [],
  };
}

function meta(head: ReturnType<typeof resolveHead>, key: string): string | undefined {
  return head.meta.find((tag) => tag.name === key || tag.property === key)?.content;
}

describe('resolveHead', () => {
  it('resolves title, description, canonical, OpenGraph, and Twitter fallbacks', () => {
    const head = resolveHead(
      state({
        title: 'Hello world',
        excerpt: 'A useful post.',
        coverImage: '/images/cover.jpg',
      }),
      {
        url: 'https://example.com',
        name: 'Example',
        titleTemplate: '%s | Example',
      },
      new URL('https://example.com/posts/hello?utm=1'),
    );

    expect(head.htmlAttrs).toEqual({ lang: 'en' });
    expect(head.title).toBe('Hello world | Example');
    expect(meta(head, 'description')).toBe('A useful post.');
    expect(meta(head, 'og:title')).toBe('Hello world | Example');
    expect(meta(head, 'og:site_name')).toBe('Example');
    expect(meta(head, 'og:image')).toBe('https://example.com/images/cover.jpg');
    expect(meta(head, 'twitter:card')).toBe('summary_large_image');
    expect(head.links).toContainEqual({
      rel: 'canonical',
      href: 'https://example.com/posts/hello',
    });
  });

  it('prefers explicit SEO fields over editorial fields', () => {
    const head = resolveHead(
      state({
        seoTitle: 'SEO title',
        title: 'Entry title',
        seoDescription: 'SEO description',
        description: 'Entry description',
        seoImage: 'https://cdn.example.com/seo.jpg',
        canonicalUrl: 'https://canonical.example.com/custom',
      }),
      { name: 'Example' },
      new URL('https://example.com/posts/hello'),
    );

    expect(head.title).toBe('SEO title');
    expect(meta(head, 'description')).toBe('SEO description');
    expect(meta(head, 'og:image')).toBe('https://cdn.example.com/seo.jpg');
    expect(head.links).toContainEqual({
      rel: 'canonical',
      href: 'https://canonical.example.com/custom',
    });
  });

  it('marks previews, noindex entries, and not-found routes as noindex', () => {
    expect(
      meta(
        resolveHead(
          state({ title: 'Preview' }),
          {},
          new URL('https://x.test/posts/a?vulse-preview=1'),
        ),
        'robots',
      ),
    ).toBe('noindex, nofollow');

    expect(meta(resolveHead(state({ title: 'Hidden', noindex: true })), 'robots')).toBe(
      'noindex, nofollow',
    );

    expect(meta(resolveHead(state({}, { type: 'not-found' })), 'robots')).toBe('noindex, nofollow');
  });

  it('falls back to site defaults and includes entry JSON-LD', () => {
    const jsonLd = { '@context': 'https://schema.org', '@type': 'Article', headline: 'Fallback' };
    const head = resolveHead(
      state({ jsonLd }),
      {
        defaultTitle: 'Fallback title',
        defaultDescription: 'Fallback description',
        defaultImage: 'https://example.com/default.jpg',
        locale: 'nb',
      },
      new URL('https://example.com/'),
    );

    expect(head.htmlAttrs).toEqual({ lang: 'nb' });
    expect(head.title).toBe('Fallback title');
    expect(meta(head, 'description')).toBe('Fallback description');
    expect(meta(head, 'og:image')).toBe('https://example.com/default.jpg');
    expect(head.jsonLd).toEqual([jsonLd]);
  });

  it('uses resolveImage when provided', () => {
    const head = resolveHead(
      state({ seoImage: { id: '01HFCAT' } }),
      {
        url: 'https://example.com',
        resolveImage: (raw) =>
          raw && typeof raw === 'object' && 'id' in (raw as Record<string, unknown>)
            ? `https://example.com/_vulse/img/sig/w_1200,h_630,f_jpg/${(raw as { id: string }).id}.jpg`
            : undefined,
      },
    );
    const og = head.meta.find((m) => 'property' in m && m.property === 'og:image');
    expect(og?.content).toBe(
      'https://example.com/_vulse/img/sig/w_1200,h_630,f_jpg/01HFCAT.jpg',
    );
  });
});
