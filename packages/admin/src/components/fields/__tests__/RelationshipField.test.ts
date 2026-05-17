import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../../api/client.js';
import RelationshipField from '../RelationshipField.vue';

beforeEach(() => {
  vi.spyOn(client.api, 'listAll').mockResolvedValue([
    {
      id: 'a',
      collection: 'authors',
      parentId: null,
      sortOrder: 1,
      status: 'published',
      content: { name: 'Ada' },
      createdAt: '',
      updatedAt: '',
      protected: false,
    },
    {
      id: 'b',
      collection: 'authors',
      parentId: null,
      sortOrder: 2,
      status: 'published',
      content: { name: 'Bob' },
      createdAt: '',
      updatedAt: '',
      protected: false,
    },
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
