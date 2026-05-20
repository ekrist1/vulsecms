import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { probeMetadata } from '../metadata.js';
import { transformImage } from '../transform.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, '__fixtures__', 'cat.jpg');

async function loadFixture(): Promise<Buffer> {
  return readFile(fixture);
}

describe('transform', () => {
  it('resizes to requested width preserving aspect', async () => {
    const out = await transformImage(await loadFixture(), { w: 100 }, { accept: '' });
    const meta = await sharp(out.buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBeGreaterThan(0);
    expect(out.contentType).toBe('image/jpeg');
  });

  it('converts to webp when f=webp', async () => {
    const out = await transformImage(await loadFixture(), { w: 100, f: 'webp' }, { accept: '' });
    expect(out.contentType).toBe('image/webp');
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('webp');
  });

  it('uses webp when f=auto and Accept contains image/webp', async () => {
    const out = await transformImage(
      await loadFixture(),
      { w: 100, f: 'auto' },
      { accept: 'image/webp,*/*' },
    );
    expect(out.contentType).toBe('image/webp');
  });

  it('uses avif when f=auto and Accept contains image/avif', async () => {
    const out = await transformImage(
      await loadFixture(),
      { w: 100, f: 'auto' },
      { accept: 'image/avif,image/webp,*/*' },
    );
    expect(out.contentType).toBe('image/avif');
  });

  it('crops with fit=cover and explicit h', async () => {
    const out = await transformImage(
      await loadFixture(),
      { w: 100, h: 100, fit: 'cover' },
      { accept: '' },
    );
    const meta = await sharp(out.buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
  });
});

describe('probeMetadata', () => {
  it('returns width and height for a valid image', async () => {
    const meta = await probeMetadata(await loadFixture());
    expect(meta).toEqual({ width: 200, height: 133 });
  });

  it('returns null for non-image data', async () => {
    expect(await probeMetadata(Buffer.from('not an image'))).toBeNull();
  });
});
