import { describe, expect, it } from 'vitest';
import { buildImageUrl, parseImageUrl } from '../url.js';

const secret = 'test-secret';

describe('url', () => {
  it('builds a signed URL with modifiers and trailing extension', () => {
    const url = buildImageUrl({
      assetId: '01HF0EXAMPLE',
      mods: { w: 800, f: 'webp' },
      secret,
    });
    // /_vulse/img/<sig>/f_webp,w_800/01HF0EXAMPLE.webp
    expect(url).toMatch(/^\/_vulse\/img\/[A-Za-z0-9_-]{11}\/f_webp,w_800\/01HF0EXAMPLE\.webp$/);
  });

  it('uses original extension when format omitted', () => {
    const url = buildImageUrl({
      assetId: '01HF0EXAMPLE',
      mods: { w: 800 },
      secret,
      originalExt: 'jpg',
    });
    expect(url).toMatch(/\/01HF0EXAMPLE\.jpg$/);
  });

  it('uses .jpg when format=auto and originalExt missing', () => {
    const url = buildImageUrl({ assetId: 'x', mods: { f: 'auto' }, secret });
    expect(url).toMatch(/\/x\.jpg$/);
  });

  it('parseImageUrl extracts sig, mods string, assetId, ext', () => {
    const url = buildImageUrl({
      assetId: '01HF0EXAMPLE',
      mods: { w: 800, f: 'webp' },
      secret,
    });
    const parsed = parseImageUrl(url);
    expect(parsed).toEqual({
      sig: expect.stringMatching(/^[A-Za-z0-9_-]{11}$/),
      modsRaw: 'f_webp,w_800',
      assetId: '01HF0EXAMPLE',
      ext: 'webp',
    });
  });

  it('parseImageUrl returns null for non-image paths', () => {
    expect(parseImageUrl('/_vulse/site/x')).toBeNull();
    expect(parseImageUrl('/api/assets')).toBeNull();
  });

  it('parseImageUrl returns null for malformed paths', () => {
    expect(parseImageUrl('/_vulse/img/short')).toBeNull();
    expect(parseImageUrl('/_vulse/img/sig/mods/missing-ext')).toBeNull();
  });
});
