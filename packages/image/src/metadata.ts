import sharp from 'sharp';

export interface ProbedMetadata {
  width: number;
  height: number;
}

export async function probeMetadata(buf: Buffer): Promise<ProbedMetadata | null> {
  try {
    const meta = await sharp(buf).metadata();
    if (typeof meta.width !== 'number' || typeof meta.height !== 'number') return null;
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}
