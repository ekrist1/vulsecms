import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useBlueprintsStore } from '../blueprints.js';
import * as client from '../../api/client.js';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(client.api, 'meta').mockResolvedValue([
    { handle: 'posts', label: 'Posts', fields: [] },
    { handle: 'authors', label: 'Authors', fields: [] },
  ]);
});

describe('useBlueprintsStore', () => {
  it('hydrates from /api/_meta/collections', async () => {
    const store = useBlueprintsStore();
    await store.hydrate();
    expect(store.list.map((b) => b.handle).sort()).toEqual(['authors', 'posts']);
    expect(store.get('posts')?.label).toBe('Posts');
  });

  it('only hydrates once', async () => {
    const store = useBlueprintsStore();
    await store.hydrate();
    await store.hydrate();
    expect(client.api.meta).toHaveBeenCalledTimes(1);
  });
});
