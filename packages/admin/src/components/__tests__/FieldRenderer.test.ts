import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import FieldRenderer from '../FieldRenderer.vue';

describe('FieldRenderer', () => {
  it('renders a text input for ui.kind=text', () => {
    const w = mount(FieldRenderer, {
      props: {
        meta: { name: 'title', ui: { kind: 'text' }, optional: false },
        modelValue: 'hi',
      },
    });
    expect(w.find('[data-testid="field-title"]').element.tagName).toBe('INPUT');
  });

  it('renders a textarea for ui.kind=textarea', () => {
    const w = mount(FieldRenderer, {
      props: {
        meta: { name: 'bio', ui: { kind: 'textarea' }, optional: true },
        modelValue: '',
      },
    });
    expect(w.find('[data-testid="field-bio"]').element.tagName).toBe('TEXTAREA');
  });

  it('renders a checkbox for ui.kind=boolean', () => {
    const w = mount(FieldRenderer, {
      props: {
        meta: { name: 'isFeatured', ui: { kind: 'boolean' }, optional: false },
        modelValue: false,
      },
    });
    expect(w.find('[data-testid="field-isFeatured"]').attributes('type')).toBe('checkbox');
  });

  it('renders a select for ui.kind=select', () => {
    const w = mount(FieldRenderer, {
      props: {
        meta: {
          name: 'status',
          ui: { kind: 'select', options: ['draft', 'published'] },
          optional: false,
        },
        modelValue: 'draft',
      },
    });
    expect(w.find('[data-testid="field-status"]').element.tagName).toBe('SELECT');
    expect(w.findAll('option')).toHaveLength(3);
  });

  it('renders a replicator host for ui.kind=replicator', () => {
    const w = mount(FieldRenderer, {
      props: {
        meta: {
          name: 'content',
          ui: {
            kind: 'replicator',
            sets: [{ name: 'text', label: 'Text', fields: [{ name: 'body', ui: { kind: 'textarea' }, optional: false }] }],
          },
          optional: false,
        },
        modelValue: [],
      },
    });
    expect(w.find('[data-testid="field-content"]').exists()).toBe(true);
  });

  it('emits update:modelValue on input', async () => {
    const w = mount(FieldRenderer, {
      props: {
        meta: { name: 'title', ui: { kind: 'text' }, optional: false },
        modelValue: '',
      },
    });
    await w.find('input').setValue('typed');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['typed']);
  });
});
