import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import VulseAccordionNodeView from '../VulseAccordionNodeView.vue';
import VulseCalloutNodeView from '../VulseCalloutNodeView.vue';
import VulseIframeNodeView from '../VulseIframeNodeView.vue';

function nodeViewProps(overrides: Record<string, unknown>) {
  return {
    editor: {} as never,
    node: { attrs: {} } as never,
    decorations: [],
    selected: false,
    extension: {} as never,
    getPos: () => 0,
    updateAttributes: vi.fn(),
    deleteNode: vi.fn(),
    view: {} as never,
    innerDecorations: {} as never,
    HTMLAttributes: {},
    ...overrides,
  } as any;
}

const nodeViewGlobal = {
  provide: {
    onDragStart: () => undefined,
    decorationClasses: '',
  },
};

describe('set node views', () => {
  it('updates callout tone inline', async () => {
    const updateAttributes = vi.fn();
    const wrapper = mount(VulseCalloutNodeView, {
      props: nodeViewProps({
        node: { attrs: { tone: 'info' } },
        updateAttributes,
      }),
      global: nodeViewGlobal,
    });

    await wrapper.get('[data-testid="callout-tone"]').setValue('warn');
    expect(updateAttributes).toHaveBeenCalledWith({ tone: 'warn' });
  });

  it('updates accordion summary inline', async () => {
    const updateAttributes = vi.fn();
    const wrapper = mount(VulseAccordionNodeView, {
      props: nodeViewProps({
        node: { attrs: { summary: 'FAQ', open: false } },
        updateAttributes,
      }),
      global: nodeViewGlobal,
    });

    await wrapper.get('[data-testid="accordion-summary"]').setValue('Updated FAQ');
    expect(updateAttributes).toHaveBeenCalledWith({ summary: 'Updated FAQ' });
  });

  it('commits iframe code inline', async () => {
    const updateAttributes = vi.fn();
    const wrapper = mount(VulseIframeNodeView, {
      props: nodeViewProps({
        node: { attrs: { code: null, src: null, title: 'Embedded content' } },
        updateAttributes,
      }),
      global: nodeViewGlobal,
    });

    const code = '<iframe src="https://example.com/embed" title="Product demo" width="640"></iframe>';
    await wrapper.get('[data-testid="iframe-code"]').setValue(code);
    await wrapper.get('[data-testid="iframe-code"]').trigger('blur');
    expect(updateAttributes).toHaveBeenCalledWith({
      code,
      src: 'https://example.com/embed',
      title: 'Product demo',
      width: '640',
    });
  });
});
