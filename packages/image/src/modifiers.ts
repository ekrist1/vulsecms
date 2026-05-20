export type ImageFormat = 'webp' | 'avif' | 'jpg' | 'png' | 'auto';
export type ImageFit = 'cover' | 'contain' | 'inside' | 'outside';
export type ImagePos = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'attention';

export interface ImageModifiers {
  w?: number;
  h?: number;
  f?: ImageFormat;
  q?: number;
  fit?: ImageFit;
  pos?: ImagePos;
}

const MIN_DIM = 16;
const MAX_DIM = 4096;
const FORMATS: readonly ImageFormat[] = ['webp', 'avif', 'jpg', 'png', 'auto'];
const FITS: readonly ImageFit[] = ['cover', 'contain', 'inside', 'outside'];
const POSITIONS: readonly ImagePos[] = ['center', 'top', 'bottom', 'left', 'right', 'attention'];

const PARSERS: Record<string, (raw: string, mods: ImageModifiers) => void> = {
  w: (raw, mods) => {
    const n = parseDim(raw, 'w');
    mods.w = n;
  },
  h: (raw, mods) => {
    const n = parseDim(raw, 'h');
    mods.h = n;
  },
  f: (raw, mods) => {
    if (!(FORMATS as readonly string[]).includes(raw)) {
      throw new Error(`invalid format: ${raw}`);
    }
    mods.f = raw as ImageFormat;
  },
  q: (raw, mods) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      throw new Error(`q out of range: ${raw}`);
    }
    mods.q = n;
  },
  fit: (raw, mods) => {
    if (!(FITS as readonly string[]).includes(raw)) {
      throw new Error(`invalid fit: ${raw}`);
    }
    mods.fit = raw as ImageFit;
  },
  pos: (raw, mods) => {
    if (!(POSITIONS as readonly string[]).includes(raw)) {
      throw new Error(`invalid pos: ${raw}`);
    }
    mods.pos = raw as ImagePos;
  },
};

function parseDim(raw: string, key: 'w' | 'h'): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${key} must be an integer: ${raw}`);
  if (n < MIN_DIM || n > MAX_DIM) throw new Error(`${key} out of range: ${raw}`);
  return n;
}

export function parseModifiers(input: string): ImageModifiers {
  const mods: ImageModifiers = {};
  if (!input) return mods;
  for (const pair of input.split(',')) {
    const idx = pair.indexOf('_');
    if (idx <= 0) throw new Error(`malformed modifier: ${pair}`);
    const key = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    const parser = PARSERS[key];
    if (!parser) throw new Error(`unknown modifier: ${key}`);
    parser(value, mods);
  }
  return mods;
}

export function serializeModifiers(mods: ImageModifiers): string {
  const parts: string[] = [];
  const keys = Object.keys(mods).sort() as (keyof ImageModifiers)[];
  for (const k of keys) {
    const v = mods[k];
    if (v === undefined) continue;
    parts.push(`${k}_${v}`);
  }
  return parts.join(',');
}
