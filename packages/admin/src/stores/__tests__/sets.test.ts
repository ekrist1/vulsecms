import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../api/client.js';
import { useSetsStore } from '../sets.js';

beforeEach(() => setActivePinia(createPinia()));

describe('useSetsStore', () => {
  it('hydrates once', async () => {
    const spy = vi
      .spyOn(client.api, 'listSets')
      .mockResolvedValue([
        {
          handle: 'q',
          label: 'Q',
          fields: [{ name: 'a', ui: { kind: 'text' }, optional: false }],
          createdAt: '',
          updatedAt: '',
        },
      ]);
    const s = useSetsStore();
    await s.hydrate();
    await s.hydrate();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(s.list).toHaveLength(1);
    expect(s.get('q')?.label).toBe('Q');
  });

  it('refresh() forces re-fetch', async () => {
    const spy = vi.spyOn(client.api, 'listSets').mockResolvedValue([]);
    const s = useSetsStore();
    await s.hydrate();
    await s.refresh();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
