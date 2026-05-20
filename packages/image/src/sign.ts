import { createHmac, timingSafeEqual } from 'node:crypto';

const SIG_BYTES = 8;
const SIG_CHARS = 11; // base64url(8 bytes) length

export function signImagePath(assetId: string, mods: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(`${assetId}|${mods}`).digest();
  return mac.subarray(0, SIG_BYTES).toString('base64url');
}

export function verifyImagePath(
  sig: string,
  assetId: string,
  mods: string,
  secret: string,
): boolean {
  if (sig.length !== SIG_CHARS) return false;
  const expected = signImagePath(assetId, mods, secret);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
