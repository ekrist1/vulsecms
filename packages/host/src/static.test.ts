import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStaticAsset } from './static.js';

function fixtureRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vulse-static-'));
  for (const [path, body] of Object.entries(files)) {
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

describe('resolveStaticAsset', () => {
  it('returns the file path and inferred mime type for an existing asset', () => {
    const root = fixtureRoot({ 'app.js': 'console.log(1)' });
    const result = resolveStaticAsset({ root, reqUrl: '/app.js' });
    expect(result).not.toBeNull();
    expect(result?.path).toBe(join(root, 'app.js'));
    expect(result?.type).toContain('javascript');
  });

  it('strips the base prefix when one is supplied', () => {
    const root = fixtureRoot({ 'logo.svg': '<svg/>' });
    const result = resolveStaticAsset({
      root,
      reqUrl: '/_vulse/site/logo.svg',
      base: '/_vulse/site/',
    });
    expect(result?.path).toBe(join(root, 'logo.svg'));
    expect(result?.type).toBe('image/svg+xml');
  });

  it('returns null when path is outside base', () => {
    const root = fixtureRoot({ 'logo.svg': '<svg/>' });
    expect(
      resolveStaticAsset({ root, reqUrl: '/other/logo.svg', base: '/_vulse/site/' }),
    ).toBeNull();
  });

  it('falls back to index.html when spaFallback is true and file is missing', () => {
    const root = fixtureRoot({ 'index.html': '<!doctype html><h1>spa</h1>' });
    const result = resolveStaticAsset({
      root,
      reqUrl: '/admin/some/deep/route',
      base: '/admin',
      spaFallback: true,
    });
    expect(result?.path).toBe(join(root, 'index.html'));
    expect(result?.type).toContain('text/html');
  });

  it('returns null without spaFallback when file is missing', () => {
    const root = fixtureRoot({ 'index.html': '<!doctype html>' });
    const result = resolveStaticAsset({ root, reqUrl: '/missing.js' });
    expect(result).toBeNull();
  });

  it('refuses path traversal', () => {
    const root = fixtureRoot({ 'safe.txt': 'ok' });
    const result = resolveStaticAsset({ root, reqUrl: '/../../etc/passwd' });
    expect(result).toBeNull();
  });
});
