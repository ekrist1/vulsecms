import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../api/client.js';
import { useBlueprintsStore } from '../blueprints.js';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(client.api, 'meta').mockResolvedValue([
    { handle: 'posts', label: 'Posts', singleton: false, fields: [] },
    { handle: 'authors', label: 'Authors', singleton: false, fields: [] },
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
