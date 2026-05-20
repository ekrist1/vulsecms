import { type ImageModifiers, serializeModifiers } from './modifiers.js';
import { signImagePath } from './sign.js';

export interface BuildImageUrlInput {
  assetId: string;
  mods: ImageModifiers;
  secret: string;
  /** original file extension, e.g. 'jpg', 'png'. Used when mods.f is undefined or 'auto'. */
  originalExt?: string;
}

const PATH_PREFIX = '/_vulse/img';

export function buildImageUrl(input: BuildImageUrlInput): string {
  const { assetId, mods, secret, originalExt } = input;
  const modsString = serializeModifiers(mods);
  const sig = signImagePath(assetId, modsString, secret);
  const ext = pickExt(mods.f, originalExt);
  return `${PATH_PREFIX}/${sig}/${modsString}/${assetId}.${ext}`;
}

function pickExt(format: ImageModifiers['f'], originalExt: string | undefined): string {
  if (format && format !== 'auto') return format === 'jpg' ? 'jpg' : format;
  if (originalExt) return originalExt.replace(/^\./, '').toLowerCase();
  return 'jpg';
}

export interface ParsedImageUrl {
  sig: string;
  modsRaw: string;
  assetId: string;
  ext: string;
}

const PATH_RE = /^\/_vulse\/img\/([A-Za-z0-9_-]{11})\/([^/]+)\/([^/.]+)\.([a-z0-9]+)$/;

export function parseImageUrl(path: string): ParsedImageUrl | null {
  const match = PATH_RE.exec(path);
  if (!match) return null;
  return {
    sig: match[1]!,
    modsRaw: match[2]!,
    assetId: match[3]!,
    ext: match[4]!,
  };
}

export { type ImageModifiers } from './modifiers.js';
