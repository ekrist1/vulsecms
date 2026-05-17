import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_BLOCKS_DOC, blocksEditorExtensions } from '../blocks-editor-extensions.js';

function createEditor(content: object = EMPTY_BLOCKS_DOC) {
  return new Editor({
    extensions: blocksEditorExtensions,
    content,
  });
}

describe('blocks editor extensions', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('supports link marks', () => {
    const editor = createEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    });

    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.commands.setVulseLink('https://example.com/');

    expect(editor.getJSON()).toMatchObject({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Hello',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/' } }],
            },
          ],
        },
      ],
    });

    editor.destroy();
  });

  it('supports emoji nodes', () => {
    const editor = createEditor();
    editor.commands.insertEmoji('🙂');

    expect(editor.getJSON()).toMatchObject({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'emoji', attrs: { value: '🙂', label: null } }],
        },
      ],
    });

    editor.destroy();
  });

  it('supports accordion, iframe, and video block nodes', () => {
    const editor = createEditor();

    editor.commands.insertVulseAccordion('FAQ');

    expect(editor.getJSON()).toMatchObject({
      type: 'doc',
      content: [
        {
          type: 'vulseAccordionGroup',
          content: [
            {
              type: 'vulseAccordion',
              attrs: { summary: 'FAQ', open: false },
              content: [{ type: 'paragraph' }],
            },
          ],
        },
      ],
    });

    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'vulseAccordionGroup',
          content: [
            {
              type: 'vulseAccordion',
              attrs: { summary: 'Grouped item', open: false },
              content: [{ type: 'paragraph' }],
            },
          ],
        },
        {
          type: 'vulseAccordion',
          attrs: { summary: 'Legacy item', open: false },
          content: [{ type: 'paragraph' }],
        },
        { type: 'vulseIframe', attrs: { src: 'https://example.com/embed' } },
        { type: 'vulseVideo', attrs: { src: 'https://example.com/video.mp4' } },
      ],
    });

    expect(editor.getJSON()).toMatchObject({
      type: 'doc',
      content: [
        {
          type: 'vulseAccordionGroup',
          content: [
            {
              type: 'vulseAccordion',
              attrs: { summary: 'Grouped item', open: false },
              content: [{ type: 'paragraph' }],
            },
          ],
        },
        {
          type: 'vulseAccordion',
          attrs: { summary: 'Legacy item', open: false },
          content: [{ type: 'paragraph' }],
        },
        {
          type: 'vulseIframe',
          attrs: { src: 'https://example.com/embed' },
        },
        {
          type: 'vulseVideo',
          attrs: { src: 'https://example.com/video.mp4' },
        },
      ],
    });

    editor.destroy();
  });

  it('supports deeper heading levels and ordered lists via StarterKit', () => {
    const headingEditor = createEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Section' }] }],
    });
    headingEditor.commands.setTextSelection({ from: 1, to: 8 });
    headingEditor.commands.toggleHeading({ level: 4 });

    expect(headingEditor.getJSON()).toMatchObject({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 4 } }],
    });
    headingEditor.destroy();

    const listEditor = createEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }],
    });
    listEditor.commands.setTextSelection({ from: 1, to: 5 });
    listEditor.commands.toggleOrderedList();

    expect(listEditor.getJSON()).toMatchObject({
      type: 'doc',
      content: [{ type: 'orderedList' }],
    });
    listEditor.destroy();
  });
});
