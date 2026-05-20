import type { Entry } from '@vulse/core';
import { describe, expect, it } from 'vitest';
import { renderPage } from './entry-server.js';
import type { SiteInitialState } from './types.js';

const entry: Entry = {
  id: 'entry-1',
  collection: 'posts',
  parentId: null,
  sortOrder: 1,
  status: 'published',
  protected: false,
  content: {
    title: 'Rendered title',
    seoDescription: 'Rendered description',
    slug: 'rendered',
    jsonLd: { '@context': 'https://schema.org', '@type': 'Article', headline: 'Rendered title' },
  },
  draftContent: null,
  hasUnpublishedChanges: false,
  publishedAt: null,
  publishedBy: null,
  createdAt: '',
  updatedAt: '',
};

const state: SiteInitialState = {
  route: { type: 'entry', collection: 'posts', slug: 'rendered' },
  blueprints: [
    {
      handle: 'posts',
      label: 'Posts',
      singleton: false,
      tree: false,
      fields: [],
    },
  ],
  globals: {},
  entry,
  entries: [],
};

describe('renderPage', () => {
  it('renders SSR SEO tags and configured scripts in their requested positions', async () => {
    const html = await renderPage('/posts/rendered', state, {
      requestUrl: new URL('https://example.com/posts/rendered'),
      site: {
        url: 'https://example.com',
        name: 'Example',
        titleTemplate: '%s | Example',
        scripts: [
          {
            id: 'gtm-head',
            position: 'head',
            content: 'window.dataLayer = window.dataLayer || [];',
          },
          {
            id: 'gtm-noscript',
            position: 'bodyOpen',
            noscript:
              '<iframe src="https://www.googletagmanager.com/ns.html?id=GTM-TEST"></iframe>',
          },
          {
            id: 'analytics',
            position: 'bodyClose',
            src: 'https://analytics.example.com/script.js',
            attrs: { async: true },
          },
        ],
      },
    });

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>Rendered title | Example</title>');
    expect(html).toContain('<meta name="description" content="Rendered description" />');
    expect(html).toContain(
      '<meta property="og:url" content="https://example.com/posts/rendered" />',
    );
    expect(html).toContain('<link rel="canonical" href="https://example.com/posts/rendered" />');
    expect(html).toContain('<script type="application/ld+json">');

    const headScriptIndex = html.indexOf('data-vulse-script="gtm-head"');
    const stylesheetIndex = html.indexOf('/_vulse/site/style.css');
    const bodyOpenIndex = html.indexOf('data-vulse-script="gtm-noscript"');
    const appIndex = html.indexOf('<div id="app">');
    const bodyCloseIndex = html.indexOf('data-vulse-script="analytics"');
    const clientEntryIndex = html.indexOf('/_vulse/site/entry-client.js');

    expect(headScriptIndex).toBeGreaterThan(0);
    expect(headScriptIndex).toBeLessThan(stylesheetIndex);
    expect(bodyOpenIndex).toBeLessThan(appIndex);
    expect(bodyCloseIndex).toBeGreaterThan(clientEntryIndex);
    expect(html).toContain(
      '<script data-vulse-script="analytics" async src="https://analytics.example.com/script.js"></script>',
    );
  });

  it('omits production-only scripts outside production', async () => {
    const html = await renderPage('/posts/rendered', state, {
      environment: 'development',
      site: {
        scripts: [
          {
            id: 'prod-only',
            position: 'head',
            src: 'https://example.com/prod.js',
            productionOnly: true,
          },
        ],
      },
    });

    expect(html).not.toContain('prod-only');
  });
});
