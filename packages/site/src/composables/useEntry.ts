import type { ContentService, Entry } from '@vulse/core';
import { computed, inject } from 'vue';
import { SITE_STATE_KEY, defaultState } from '../state.js';

export function useEntry() {
  const state = inject(SITE_STATE_KEY, defaultState());
  return {
    state,
    entry: computed(() => state.entry),
    entries: computed(() => state.entries),
  };
}

export async function findPublicEntryBySlug(
  content: Pick<ContentService, 'list'>,
  collection: string,
  slug: string,
  options: { includeProtected?: boolean } = {},
): Promise<Entry | null> {
  const result = await content.list(collection, {
    field: 'slug',
    q: slug,
    limit: 100,
    includeProtected: options.includeProtected ?? false,
  });
  return result.items.find((entry) => String(entry.content.slug ?? '') === slug) ?? null;
}

export async function getPublicEntryById(
  content: Pick<ContentService, 'get'>,
  collection: string,
  id: string,
  options: { includeProtected?: boolean } = {},
): Promise<Entry | null> {
  const entry = await content.get(collection, id);
  if (!entry) return null;
  if (entry.protected && !options.includeProtected) return null;
  return entry;
}
