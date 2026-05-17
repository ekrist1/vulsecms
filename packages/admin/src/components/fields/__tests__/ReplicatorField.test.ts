import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ReplicatorField from '../ReplicatorField.vue';

describe('ReplicatorField', () => {
  it('adds a set and emits nested field updates', async () => {
    const w = mount(ReplicatorField, {
      props: {
        name: 'content',
        modelValue: [],
        sets: [
          {
            name: 'text',
            label: 'Text',
            fields: [{ name: 'body', ui: { kind: 'textarea' }, optional: false }],
          },
        ],
      },
    });

    await w.find('[data-testid="replicator-add-text"]').trigger('click');
    const added = w.emitted('update:modelValue')?.[0]?.[0] as Array<{
      set: string;
      content: Record<string, unknown>;
    }>;
    expect(added).toEqual([{ set: 'text', content: { body: '' } }]);

    await w.setProps({ modelValue: added });
    await flushPromises();
    await flushPromises();
    await w.find('textarea').setValue('Hello');

    const updated = w.emitted('update:modelValue')?.at(-1)?.[0] as Array<{
      set: string;
      content: Record<string, unknown>;
    }>;
    expect(updated).toEqual([{ set: 'text', content: { body: 'Hello' } }]);
  });
});
