import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSetsStore } from '../../../stores/sets.js';
import VulseSetNodeView from '../VulseSetNodeView.vue';

beforeEach(() => {
  setActivePinia(createPinia());
});

function makeProps(overrides?: Partial<{ set: string; data: Record<string, unknown> }>) {
  const updateAttributes = vi.fn();
  const deleteNode = vi.fn();
  return {
    props: {
      node: {
        attrs: {
          set: overrides?.set ?? 'quote',
          data: overrides?.data ?? {},
        },
      },
      updateAttributes,
      deleteNode,
    },
    updateAttributes,
    deleteNode,
  };
}

const nodeViewGlobal = {
  provide: {
    onDragStart: () => undefined,
    decorationClasses: '',
  },
};

describe('VulseSetNodeView', () => {
  it('renders the set label from the store', () => {
    const store = useSetsStore();
    store.$patch({
      map: new Map([['quote', {
        handle: 'quote', label: 'Quote',
        fields: [{ name: 'author', ui: { kind: 'text' }, optional: false }],
        createdAt: '', updatedAt: '',
      }]]),
      hydrated: true,
    });
    const { props } = makeProps();
    const w = mount(VulseSetNodeView, { props: props as any, global: nodeViewGlobal });
    expect(w.text()).toContain('Quote');
  });

  it('shows a missing-set placeholder when handle is unknown', () => {
    const { props } = makeProps({ set: 'unknown' });
    const w = mount(VulseSetNodeView, { props: props as any, global: nodeViewGlobal });
    expect(w.find('[data-testid="vulse-set-missing"]').exists()).toBe(true);
  });

  it('expanding then editing a field calls updateAttributes with merged data', async () => {
    const store = useSetsStore();
    store.$patch({
      map: new Map([['quote', {
        handle: 'quote', label: 'Quote',
        fields: [{ name: 'author', ui: { kind: 'text' }, optional: false }],
        createdAt: '', updatedAt: '',
      }]]),
      hydrated: true,
    });
    const { props, updateAttributes } = makeProps({ set: 'quote', data: { author: 'Anna' } });
    const w = mount(VulseSetNodeView, { props: props as any, global: nodeViewGlobal });
    await w.find('[data-testid="vulse-set-toggle"]').trigger('click');
    expect(w.find('[data-testid="vulse-set-form"]').exists()).toBe(true);
    // Find the underlying text input rendered by FieldRenderer for the author field
    const input = w.find('input[type="text"]');
    expect(input.exists()).toBe(true);
    await input.setValue('Bob');
    expect(updateAttributes).toHaveBeenCalledWith({ data: { author: 'Bob' } });
  });

  it('Remove button calls deleteNode', async () => {
    const store = useSetsStore();
    store.$patch({
      map: new Map([['quote', {
        handle: 'quote', label: 'Quote',
        fields: [{ name: 'q', ui: { kind: 'text' }, optional: false }],
        createdAt: '', updatedAt: '',
      }]]),
      hydrated: true,
    });
    const { props, deleteNode } = makeProps();
    const w = mount(VulseSetNodeView, { props: props as any, global: nodeViewGlobal });
    await w.find('[data-testid="vulse-set-remove"]').trigger('click');
    expect(deleteNode).toHaveBeenCalled();
  });
});
