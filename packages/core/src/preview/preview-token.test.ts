import { describe, expect, it } from 'vitest';
import { signPreviewToken, verifyPreviewToken } from './preview-token.js';

const secret = 'test-secret';

describe('preview-token', () => {
  it('round-trips entryId + userId', () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = signPreviewToken({ entryId: 'e1', userId: 'u1', exp }, secret);
    const result = verifyPreviewToken(token, secret);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.entryId).toBe('e1');
      expect(result.payload.userId).toBe('u1');
    }
  });

  it('rejects expired tokens', () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const token = signPreviewToken({ entryId: 'e1', userId: 'u1', exp }, secret);
    const result = verifyPreviewToken(token, secret);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('rejects tampered payload', () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = signPreviewToken({ entryId: 'e1', userId: 'u1', exp }, secret);
    // Mutate the payload portion (between 'vp_' prefix and '.' separator).
    const tampered = token.replace(/^vp_./, 'vp_X');
    const result = verifyPreviewToken(tampered, secret);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_signature');
  });

  it('rejects tokens signed with a different secret', () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const token = signPreviewToken({ entryId: 'e1', userId: 'u1', exp }, secret);
    const result = verifyPreviewToken(token, 'other-secret');
    expect(result.ok).toBe(false);
  });

  it('rejects malformed tokens', () => {
    const result = verifyPreviewToken('not-a-token', secret);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });
});
