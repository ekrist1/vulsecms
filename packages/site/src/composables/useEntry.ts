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

export function useCollection(handle?: string) {
  const state = inject(SITE_STATE_KEY, defaultState());
  const collection = computed(() => handle ?? state.route.collection);
  return {
    state,
    collection,
    entries: computed(() =>
      collection.value
        ? state.entries.filter((entry) => entry.collection === collection.value)
        : state.entries,
    ),
  };
}

export function useGlobals() {
  const state = inject(SITE_STATE_KEY, defaultState());
  return {
    globals: computed(() => state.globals),
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
  const entry = result.items.find((item) => String(item.content.slug ?? '') === slug);
  if (!entry || entry.status !== 'published') return null;
  return entry;
}

export async function getPublicEntryById(
  content: Pick<ContentService, 'get'>,
  collection: string,
  id: string,
  options: { includeProtected?: boolean } = {},
): Promise<Entry | null> {
  const entry = await content.get(collection, id);
  if (!entry) return null;
  if (entry.status !== 'published') return null;
  if (entry.protected && !options.includeProtected) return null;
  return entry;
}
