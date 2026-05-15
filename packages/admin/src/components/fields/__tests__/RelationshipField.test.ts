import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import RelationshipField from '../RelationshipField.vue';
import * as client from '../../../api/client.js';

beforeEach(() => {
  vi.spyOn(client.api, 'list').mockResolvedValue([
    { id: 'a', collection: 'authors', parentId: null, sortOrder: 1, status: 'published', content: { name: 'Ada' }, createdAt: '', updatedAt: '' },
    { id: 'b', collection: 'authors', parentId: null, sortOrder: 2, status: 'published', content: { name: 'Bob' }, createdAt: '', updatedAt: '' },
  ]);
});

describe('RelationshipField', () => {
  it('loads options from the API and renders them', async () => {
    const w = mount(RelationshipField, {
      props: { name: 'author', modelValue: undefined, to: 'authors' },
    });
    await flushPromises();
    const opts = w.findAll('option');
    expect(opts.map((o) => o.text())).toEqual(['Select a authors', 'Ada', 'Bob']);
  });

  it('emits update:modelValue when an option is chosen', async () => {
    const w = mount(RelationshipField, {
      props: { name: 'author', modelValue: undefined, to: 'authors' },
    });
    await flushPromises();
    await w.find('select').setValue('a');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['a']);
  });
});
