import sharp, { type FitEnum } from 'sharp';
import type { ImageFormat, ImageModifiers } from './modifiers.js';

export interface TransformContext {
  /** Raw Accept header from the request, used for f=auto negotiation. */
  accept: string;
}

export interface TransformResult {
  buffer: Buffer;
  contentType: string;
  ext: string;
}

const CONTENT_TYPES: Record<Exclude<ImageFormat, 'auto'>, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpg: 'image/jpeg',
  png: 'image/png',
};

const FIT_MAP: Record<NonNullable<ImageModifiers['fit']>, keyof FitEnum> = {
  cover: 'cover',
  contain: 'contain',
  inside: 'inside',
  outside: 'outside',
};

export async function transformImage(
  input: Buffer,
  mods: ImageModifiers,
  ctx: TransformContext,
): Promise<TransformResult> {
  let pipeline = sharp(input, { failOn: 'none' });

  if (mods.w || mods.h) {
    pipeline = pipeline.resize({
      width: mods.w,
      height: mods.h,
      fit: mods.fit ? FIT_MAP[mods.fit] : 'cover',
      position: mods.pos ?? 'center',
      withoutEnlargement: true,
    });
  }

  const format = resolveFormat(mods.f, ctx.accept);
  const quality = mods.q ?? 75;

  switch (format) {
    case 'webp':
      pipeline = pipeline.webp({ quality });
      break;
    case 'avif':
      pipeline = pipeline.avif({ quality });
      break;
    case 'jpg':
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      break;
    case 'png':
      pipeline = pipeline.png({ compressionLevel: 9 });
      break;
  }

  const buffer = await pipeline.toBuffer();
  return { buffer, contentType: CONTENT_TYPES[format], ext: format === 'jpg' ? 'jpg' : format };
}

function resolveFormat(
  requested: ImageFormat | undefined,
  accept: string,
): Exclude<ImageFormat, 'auto'> {
  if (requested && requested !== 'auto') return requested;
  if (accept.includes('image/avif')) return 'avif';
  if (accept.includes('image/webp')) return 'webp';
  return 'jpg';
}
