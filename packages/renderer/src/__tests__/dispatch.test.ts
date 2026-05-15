import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import BlockRenderer from '../BlockRenderer.vue';

const Para = defineComponent({
  props: { node: { type: Object, required: true } },
  setup(props) {
    return () => h('p', (props.node as { content?: { text: string }[] }).content?.[0]?.text);
  },
});

describe('BlockRenderer dispatch', () => {
  it('dispatches node.type to a custom component', () => {
    const w = mount(BlockRenderer, {
      props: {
        doc: { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
        components: { paragraph: Para },
      },
    });
    expect(w.html()).toContain('<p>Hello</p>');
  });

  it('renders nothing for unknown types', () => {
    const w = mount(BlockRenderer, {
      props: { doc: { type: 'unknown' } },
    });
    expect(w.text()).toBe('');
  });
});
