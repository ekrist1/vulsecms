import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BlocksField from '../BlocksField.vue';

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

describe('BlocksField special sets', () => {
  it('inserts accordion, iframe, and video without using browser prompts', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const wrapper = mount(BlocksField, {
      props: {
        name: 'body',
        modelValue: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    });

    await wrapper.get('[data-testid="blocks-accordion"]').trigger('click');
    await flushPromises();
    expect(promptSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="accordion-group-node-view"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="accordion-node-view"]').exists()).toBe(true);

    await wrapper.get('[data-testid="blocks-iframe"]').trigger('click');
    await flushPromises();
    expect(promptSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="iframe-node-view"]').exists()).toBe(true);

    await wrapper.get('[data-testid="blocks-video"]').trigger('click');
    await flushPromises();
    expect(promptSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="video-node-view"]').exists()).toBe(true);
  });

  it('lets you add another accordion item from the node view', async () => {
    const wrapper = mount(BlocksField, {
      props: {
        name: 'body',
        modelValue: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    });

    await wrapper.get('[data-testid="blocks-accordion"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="accordion-group-add-item"]').trigger('click');
    await flushPromises();

    expect(wrapper.findAll('[data-testid="accordion-group-node-view"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="accordion-node-view"]')).toHaveLength(2);
  });

  it('removes the whole group when deleting its last item', async () => {
    const wrapper = mount(BlocksField, {
      props: {
        name: 'body',
        modelValue: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    });

    await wrapper.get('[data-testid="blocks-accordion"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="accordion-delete"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="accordion-group-node-view"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="accordion-node-view"]').exists()).toBe(false);
  });
});
