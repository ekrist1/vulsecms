import { describe, expect, it } from 'vitest';
import { signImagePath, verifyImagePath } from '../sign.js';

const secret = 'test-secret';

describe('sign', () => {
  it('produces a stable signature for the same inputs', () => {
    const a = signImagePath('asset-1', 'w_800,f_webp', secret);
    const b = signImagePath('asset-1', 'w_800,f_webp', secret);
    expect(a).toBe(b);
    expect(a).toHaveLength(11); // base64url 8 bytes → 11 chars (no padding)
  });

  it('produces different signatures for different mods', () => {
    const a = signImagePath('asset-1', 'w_800,f_webp', secret);
    const b = signImagePath('asset-1', 'w_801,f_webp', secret);
    expect(a).not.toBe(b);
  });

  it('produces different signatures for different secrets', () => {
    expect(signImagePath('x', 'm', 'a')).not.toBe(signImagePath('x', 'm', 'b'));
  });

  it('verifyImagePath returns true for matching sig', () => {
    const sig = signImagePath('asset-1', 'w_800', secret);
    expect(verifyImagePath(sig, 'asset-1', 'w_800', secret)).toBe(true);
  });

  it('verifyImagePath returns false for tampered mods', () => {
    const sig = signImagePath('asset-1', 'w_800', secret);
    expect(verifyImagePath(sig, 'asset-1', 'w_900', secret)).toBe(false);
  });

  it('verifyImagePath returns false for tampered sig', () => {
    expect(verifyImagePath('xxxxxxxxxxx', 'asset-1', 'w_800', secret)).toBe(false);
  });

  it('uses constant-time comparison', () => {
    expect(verifyImagePath('short', 'asset-1', 'w_800', secret)).toBe(false);
    expect(verifyImagePath('a'.repeat(50), 'asset-1', 'w_800', secret)).toBe(false);
  });
});
