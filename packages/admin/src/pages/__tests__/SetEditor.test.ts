import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import * as client from '../../api/client.js';
import SetEditor from '../SetEditor.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/settings/sets', component: { template: '<div/>' } }],
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('SetEditor', () => {
  it('creates a set with handle, label, and one text field', async () => {
    const create = vi.spyOn(client.api, 'createSet').mockResolvedValue({
      handle: 'quote', label: 'Quote',
      fields: [{ name: 'q', ui: { kind: 'text' }, optional: false }],
      createdAt: '', updatedAt: '',
    });
    const w = mount(SetEditor, { props: { handle: null }, global: { plugins: [router] } });
    await flushPromises();
    await w.find('[data-testid="set-handle"]').setValue('quote');
    await w.find('[data-testid="set-label"]').setValue('Quote');
    await w.find('[data-testid="set-add-field"]').trigger('click');
    await w.find('[data-testid="set-field-name-0"]').setValue('q');
    await w.find('[data-testid="set-save"]').trigger('click');
    await flushPromises();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      handle: 'quote',
      label: 'Quote',
      fields: [expect.objectContaining({ name: 'q' })],
    }));
  });
});
