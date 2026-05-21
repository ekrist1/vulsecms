import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPageLayout, routeFromPageFile, scanSite } from '../../src/vite/plugin.js';

function tempSite() {
  const dir = mkdtempSync(join(tmpdir(), 'vulse-site-'));
  mkdirSync(join(dir, 'pages', 'elearning'), { recursive: true });
  mkdirSync(join(dir, 'layouts'), { recursive: true });
  writeFileSync(join(dir, 'layouts', 'marketing.vue'), '<template><slot /></template>');
  writeFileSync(join(dir, 'pages', 'index.vue'), '<template>Home</template>');
  writeFileSync(
    join(dir, 'pages', 'elearning', 'index.vue'),
    '<script setup>definePageMeta({ layout: "marketing" })</script><template>List</template>',
  );
  writeFileSync(join(dir, 'pages', 'elearning', 'show.vue'), '<template>Show</template>');
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('site manifest scanning', () => {
  it('extracts page layout metadata', () => {
    expect(extractPageLayout('definePageMeta({ layout: "marketing" })')).toBe('marketing');
    expect(extractPageLayout('<template />')).toBe('default');
  });

  it('maps root, collection index, and collection show files to routes', () => {
    const site = tempSite();
    try {
      const pagesDir = join(site.dir, 'pages');
      expect(routeFromPageFile(pagesDir, join(pagesDir, 'index.vue'))).toMatchObject({
        path: '/',
        kind: 'page',
      });
      expect(routeFromPageFile(pagesDir, join(pagesDir, 'elearning', 'index.vue'))).toMatchObject({
        path: '/elearning',
        kind: 'list',
        collection: 'elearning',
        layout: 'marketing',
      });
      expect(routeFromPageFile(pagesDir, join(pagesDir, 'elearning', 'show.vue'))).toMatchObject({
        path: '/elearning/:slug',
        kind: 'entry',
        collection: 'elearning',
      });
    } finally {
      site.cleanup();
    }
  });

  it('scans site layouts and pages', () => {
    const site = tempSite();
    try {
      const scan = scanSite(site.dir);
      expect(scan.layouts.map((layout) => layout.name)).toEqual(['marketing']);
      expect(scan.pages.map((page) => page.path)).toEqual(['/elearning', '/elearning/:slug', '/']);
    } finally {
      site.cleanup();
    }
  });
});
