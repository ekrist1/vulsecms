import { describe, expect, it } from 'vitest';
import { resolveSecrets } from './secrets.js';

describe('resolveSecrets', () => {
  it('uses VULSE_PREVIEW_SECRET when present', () => {
    const out = resolveSecrets({
      env: {
        VULSE_PREVIEW_SECRET: 'preview-from-env',
        VULSE_IMAGE_SECRET: 'image-from-env',
        VULSE_IMAGE_CACHE_DIR: '/tmp/img',
      },
      appRoot: '/app',
    });
    expect(out.previewSecret).toBe('preview-from-env');
    expect(out.imageSecret).toBe('image-from-env');
    expect(out.imageCacheDir).toBe('/tmp/img');
    expect(out.previewSecretEphemeral).toBe(false);
  });

  it('falls back to VULSE_SESSION_SECRET for preview, then to ephemeral', () => {
    const out = resolveSecrets({
      env: { VULSE_SESSION_SECRET: 'session-fallback' },
      appRoot: '/app',
    });
    expect(out.previewSecret).toBe('session-fallback');
    expect(out.previewSecretEphemeral).toBe(false);
    // imageSecret falls back to session secret too
    expect(out.imageSecret).toBe('session-fallback');
  });

  it('generates an ephemeral preview secret when nothing is set', () => {
    const out = resolveSecrets({ env: {}, appRoot: '/app' });
    expect(out.previewSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(out.previewSecretEphemeral).toBe(true);
    // imageSecret falls back to previewSecret
    expect(out.imageSecret).toBe(out.previewSecret);
  });

  it('defaults imageCacheDir to <appRoot>/.vulse/cache/img', () => {
    const out = resolveSecrets({ env: {}, appRoot: '/work/myapp' });
    expect(out.imageCacheDir).toBe('/work/myapp/.vulse/cache/img');
  });
});
