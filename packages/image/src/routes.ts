import type { DatabaseAdapter } from '@vulse/db';
import {
  type Router,
  createRouter,
  defineEventHandler,
  getRequestHeader,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from 'h3';
import { createDiskCache, cacheKey } from './cache.js';
import { dedupe } from './dedupe.js';
import { fetchAssetSource } from './fetch-source.js';
import { parseModifiers } from './modifiers.js';
import { parseImageUrl, buildImageUrl } from './url.js';
import { verifyImagePath } from './sign.js';
import { transformImage } from './transform.js';

export interface ImageRoutesOptions {
  secret: string;
  cacheDir: string;
}

export function imageRoutes(adapter: DatabaseAdapter, opts: ImageRoutesOptions): Router {
  const router = createRouter();
  const cache = createDiskCache(opts.cacheDir);

  router.get(
    '/_vulse/img/**',
    defineEventHandler(async (event) => {
      const path = event.path.split('?')[0]!;
      const parsed = parseImageUrl(path);
      if (!parsed) {
        setResponseStatus(event, 400);
        return { error: 'malformed_url' };
      }

      if (!verifyImagePath(parsed.sig, parsed.assetId, parsed.modsRaw, opts.secret)) {
        setResponseStatus(event, 403);
        return { error: 'bad_signature' };
      }

      let mods;
      try {
        mods = parseModifiers(parsed.modsRaw);
      } catch (err) {
        setResponseStatus(event, 400);
        return { error: 'bad_modifiers', message: (err as Error).message };
      }

      const key = cacheKey(parsed.assetId, parsed.modsRaw, parsed.ext);
      const hit = await cache.get(key);
      if (hit) {
        setResponseHeader(event, 'content-type', hit.contentType);
        setResponseHeader(event, 'cache-control', 'public, max-age=31536000, immutable');
        setResponseHeader(event, 'etag', `"${key}"`);
        return hit.buffer;
      }

      const accept = getRequestHeader(event, 'accept') ?? '';

      const result = await dedupe(key, async () => {
        const source = await fetchAssetSource(adapter, parsed.assetId);
        if (!source) return null;
        const out = await transformImage(source.buffer, mods, { accept });
        await cache.put(key, { buffer: out.buffer, contentType: out.contentType });
        return { buffer: out.buffer, contentType: out.contentType };
      });

      if (!result) {
        setResponseStatus(event, 404);
        return { error: 'asset_not_found' };
      }

      setResponseHeader(event, 'content-type', result.contentType);
      setResponseHeader(event, 'cache-control', 'public, max-age=31536000, immutable');
      setResponseHeader(event, 'etag', `"${key}"`);
      return result.buffer;
    }),
  );

  router.get(
    '/api/assets/:id/thumb-url',
    defineEventHandler(async (event) => {
      if (!event.context.user) {
        setResponseStatus(event, 401);
        return { error: 'auth_required' };
      }
      const id = getRouterParam(event, 'id') as string;
      const widthParam = (event.path.split('?')[1] ?? '').match(/(?:^|&)w=(\d+)/);
      const w = widthParam ? Math.min(Math.max(Number(widthParam[1]), 16), 4096) : 240;
      const url = buildImageUrl({
        assetId: id,
        mods: { w, f: 'webp', q: 80 },
        secret: opts.secret,
      });
      return { url };
    }),
  );

  return router;
}
