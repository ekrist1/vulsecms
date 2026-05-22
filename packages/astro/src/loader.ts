import { vulseSchemaFor } from './schema.js';
import type {
  AstroLoader,
  AstroLoaderContext,
  VulseEntry,
  VulseListResponse,
  VulseLoaderOptions,
} from './types.js';

const LAST_UPDATED_KEY = 'vulse:lastUpdatedAt';

/**
 * Create an Astro Content Layer loader that syncs a Vulse collection.
 *
 * ```ts
 * // src/content.config.ts
 * import { defineCollection } from 'astro:content';
 * import { vulseLoader } from '@vulse/astro';
 *
 * export const collections = {
 *   posts: defineCollection({
 *     loader: vulseLoader({
 *       url: import.meta.env.VULSE_URL,
 *       collection: 'posts',
 *     }),
 *   }),
 * };
 * ```
 *
 * The loader supports incremental sync: subsequent runs only fetch
 * entries updated since the last successful run (tracked via Astro's
 * meta store).
 */
export function vulseLoader(opts: VulseLoaderOptions): AstroLoader {
  const baseUrl = opts.url.replace(/\/$/, '');
  const pageSize = Math.max(1, Math.min(opts.pageSize ?? 200, 500));
  const fetchImpl = opts.fetch ?? fetch;

  return {
    name: `vulse:${opts.collection}`,
    async load(context) {
      await syncCollection(baseUrl, opts.collection, pageSize, fetchImpl, context);
      if (opts.preview) {
        await overlayPreview(baseUrl, opts.collection, opts.preview, fetchImpl, context);
      }
    },
    async schema() {
      return await vulseSchemaFor(baseUrl, opts.collection, fetchImpl);
    },
  };
}

async function syncCollection(
  baseUrl: string,
  collection: string,
  pageSize: number,
  fetchImpl: typeof fetch,
  context: AstroLoaderContext,
): Promise<void> {
  const since = context.meta.get(LAST_UPDATED_KEY);
  let offset = 0;
  let maxUpdatedAt = since ?? '';
  let synced = 0;

  while (true) {
    const url = new URL(`${baseUrl}/api/public/collections/${collection}`);
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));
    if (since) url.searchParams.set('since', since);

    const res = await fetchImpl(url.toString());
    if (!res.ok) {
      throw new Error(`Vulse responded ${res.status} for ${collection}`);
    }
    const body = (await res.json()) as VulseListResponse;

    for (const item of body.items) {
      await writeEntry(item, context);
      if (item.updatedAt > maxUpdatedAt) maxUpdatedAt = item.updatedAt;
      synced++;
    }

    if (body.items.length === 0 || synced >= body.total) break;
    offset += body.items.length;
  }

  context.logger.info(
    since
      ? `vulse: synced ${synced} updated ${collection} ${plural('entry', synced)}`
      : `vulse: synced ${synced} ${collection} ${plural('entry', synced)}`,
  );
  if (maxUpdatedAt) context.meta.set(LAST_UPDATED_KEY, maxUpdatedAt);
}

async function overlayPreview(
  baseUrl: string,
  collection: string,
  preview: NonNullable<VulseLoaderOptions['preview']>,
  fetchImpl: typeof fetch,
  context: AstroLoaderContext,
): Promise<void> {
  const url = new URL(`${baseUrl}/api/public/collections/${collection}/${preview.entryId}`);
  url.searchParams.set('preview', preview.token);
  const res = await fetchImpl(url.toString());
  if (!res.ok) {
    context.logger.warn(
      `vulse: preview token rejected (${res.status}) for ${collection}/${preview.entryId}`,
    );
    return;
  }
  const entry = (await res.json()) as VulseEntry;
  await writeEntry(entry, context);
  context.logger.info(`vulse: overlaid draft ${collection}/${preview.entryId} via preview token`);
}

async function writeEntry(item: VulseEntry, context: AstroLoaderContext): Promise<void> {
  const data = await context.parseData({ id: item.id, data: item.content });
  context.store.set({
    id: item.id,
    data,
    digest: item.contentHash,
  });
}

function plural(word: string, n: number): string {
  return n === 1 ? word : `${word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`}`;
}
