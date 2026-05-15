import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import BlockRenderer from '../BlockRenderer.vue';

describe('default blocks', () => {
  it('renders paragraph with text', () => {
    const w = mount(BlockRenderer, {
      props: {
        doc: { type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] },
      },
    });
    expect(w.html()).toContain('<p class="vulse-paragraph">Hi</p>');
  });

  it('renders heading at given level', () => {
    const w = mount(BlockRenderer, {
      props: {
        doc: { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
      },
    });
    expect(w.html()).toContain('<h2');
    expect(w.html()).toContain('>H</h2>');
  });

  it('applies bold mark via <strong>', () => {
    const w = mount(BlockRenderer, {
      props: {
        doc: {
          type: 'paragraph',
          content: [{ type: 'text', text: 'B', marks: [{ type: 'bold' }] }],
        },
      },
    });
    expect(w.html()).toContain('<strong>B</strong>');
  });

  it('renders vulseCallout with tone class', () => {
    const w = mount(BlockRenderer, {
      props: {
        doc: {
          type: 'vulseCallout',
          attrs: { tone: 'warn' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'careful' }] }],
        },
      },
    });
    expect(w.html()).toContain('vulse-callout--warn');
    expect(w.text()).toContain('careful');
  });
});
