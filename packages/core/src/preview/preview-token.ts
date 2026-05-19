import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PreviewTokenPayload {
  entryId: string;
  userId: string;
  exp: number; // unix seconds
}

export type PreviewVerifyResult =
  | { ok: true; payload: PreviewTokenPayload }
  | { ok: false; reason: 'malformed' | 'invalid_signature' | 'expired' };

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s: string): Buffer {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signPreviewToken(payload: PreviewTokenPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `vp_${body}.${sig}`;
}

export function verifyPreviewToken(token: string, secret: string): PreviewVerifyResult {
  if (!token.startsWith('vp_')) return { ok: false, reason: 'malformed' };
  const rest = token.slice(3);
  const dot = rest.indexOf('.');
  if (dot < 0) return { ok: false, reason: 'malformed' };
  const body = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);

  const expected = b64url(createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  let payload: PreviewTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    !payload ||
    typeof payload.entryId !== 'string' ||
    typeof payload.userId !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}
