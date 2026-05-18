import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import BlockRenderer from '../BlockRenderer.vue';
import type { BlockNode } from '../types.js';

const Quote = defineComponent({
  props: { data: { type: Object, required: true } },
  setup(p) {
    return () => h('blockquote', null, [`${p.data.quote} — ${p.data.author}`]);
  },
});

describe('vulseSet renderer', () => {
  it('dispatches to components[set:<handle>]', () => {
    const doc: BlockNode = {
      type: 'doc',
      content: [{ type: 'vulseSet', attrs: { set: 'quote', data: { quote: 'L', author: 'A' } } }],
    };
    const w = mount(BlockRenderer, {
      props: { doc, components: { 'set:quote': Quote } },
    });
    expect(w.html()).toContain('L — A');
  });

  it('renders a missing-set placeholder when no component is registered', () => {
    const doc: BlockNode = {
      type: 'doc',
      content: [{ type: 'vulseSet', attrs: { set: 'unknown', data: {} } }],
    };
    const w = mount(BlockRenderer, { props: { doc } });
    expect(w.find('[data-vulse-missing-set]').exists()).toBe(true);
  });
});
