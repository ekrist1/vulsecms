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
    expect(w.html()).toContain('data-vulse-callout');
    expect(w.html()).toContain('data-tone="warn"');
    expect(w.text()).toContain('careful');
  });

  it('renders link marks, emoji, grouped accordions, iframe, and video nodes', () => {
    const w = mount(BlockRenderer, {
      props: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Docs',
                  marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
                },
                { type: 'emoji', attrs: { value: '🙂', label: 'smile' } },
              ],
            },
            {
              type: 'vulseAccordionGroup',
              content: [
                {
                  type: 'vulseAccordion',
                  attrs: { summary: 'FAQ' },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Answer' }] }],
                },
              ],
            },
            {
              type: 'vulseIframe',
              attrs: {
                code: '<iframe src="https://example.com/embed" title="Preview" width="640" height="360" allowfullscreen></iframe>',
              },
            },
            {
              type: 'vulseVideo',
              attrs: { src: 'https://example.com/video.mp4' },
            },
          ],
        },
      },
    });

    expect(w.html()).toContain('<a class="vulse-link" href="https://example.com/">Docs</a>');
    expect(w.html()).toContain('data-vulse-emoji');
    expect(w.html()).toContain('data-vulse-accordion-group');
    expect(w.html()).toContain('<summary>FAQ</summary>');
    expect(w.html()).toContain('data-vulse-accordion');
    expect(w.html()).toContain('data-vulse-embed="iframe"');
    expect(w.html()).toContain('width="640"');
    expect(w.html()).toContain('data-vulse-embed="video"');
  });
});
