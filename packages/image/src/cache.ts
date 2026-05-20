import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface CacheEntry {
  buffer: Buffer;
  contentType: string;
}

export interface DiskCache {
  get(key: string): Promise<CacheEntry | null>;
  put(key: string, entry: CacheEntry): Promise<void>;
}

export function cacheKey(assetId: string, mods: string, ext: string): string {
  const hash = createHash('sha256').update(`${assetId}|${mods}`).digest('hex');
  return `${hash}.${ext}`;
}

export function createDiskCache(rootDir: string): DiskCache {
  return {
    async get(key) {
      const path = pathFor(rootDir, key);
      if (!existsSync(path)) return null;
      const buffer = await readFile(path);
      return { buffer, contentType: contentTypeFor(key) };
    },
    async put(key, entry) {
      const path = pathFor(rootDir, key);
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, entry.buffer);
      await rename(tmp, path);
    },
  };
}

function pathFor(root: string, key: string): string {
  // shard by first 2 hex chars to avoid one giant directory
  return join(root, key.slice(0, 2), key);
}

function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1);
  switch (ext) {
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'png':
      return 'image/png';
    default:
      return 'image/jpeg';
  }
}
