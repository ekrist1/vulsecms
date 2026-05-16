import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import * as client from '../../api/client.js';
import BlueprintEditor from '../BlueprintEditor.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/schema', component: { template: '<div/>' } },
    { path: '/schema/:handle', component: { template: '<div/>' } },
  ],
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(client.api, 'meta').mockResolvedValue([]);
  vi.spyOn(client.api, 'getBlueprint').mockResolvedValue({
    handle: 'posts',
    label: 'Posts',
    singleton: false,
    fields: [
      { name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false },
      { name: 'body', label: 'Body', ui: { kind: 'blocks' }, optional: false },
    ],
  });
});

function mountEditor(handle: string | null) {
  return mount(BlueprintEditor, {
    props: { handle },
    global: { plugins: [router] },
  });
}

describe('BlueprintEditor', () => {
  it('add field appends a card', async () => {
    const w = mountEditor(null);
    await flushPromises();
    expect(w.findAll('[data-testid^="field-card-"]')).toHaveLength(0);
    await w.find('[data-testid="add-field"]').trigger('click');
    expect(w.findAll('[data-testid^="field-card-"]')).toHaveLength(1);
  });

  it('reorders fields with up/down buttons', async () => {
    const w = mountEditor('posts');
    await flushPromises();
    const cards = () =>
      w.findAll('[data-testid^="field-card-"]').map((el) => el.attributes('data-testid'));
    expect(cards()).toEqual(['field-card-title', 'field-card-body']);
    await w.find('[data-testid="field-down-0"]').trigger('click');
    expect(cards()).toEqual(['field-card-body', 'field-card-title']);
  });

  it('switching kind to select reveals the options editor', async () => {
    const w = mountEditor('posts');
    await flushPromises();
    // Expand the first field card by clicking its header button
    await w.find('[data-testid="field-expand-0"]').trigger('click');
    // Change kind to select
    const kindSelect = w.find('[data-testid="field-kind-0"]');
    await kindSelect.setValue('select');
    expect(w.find('[data-testid="field-options-0"]').exists()).toBe(true);
  });

  it('submits previousName only when name was renamed', async () => {
    const updateSpy = vi.spyOn(client.api, 'updateBlueprint').mockResolvedValue({
      handle: 'posts',
      label: 'Posts',
      singleton: false,
      fields: [],
    });
    const w = mountEditor('posts');
    await flushPromises();

    // Expand the 'title' card and rename it to 'headline'
    await w.find('[data-testid="field-expand-0"]').trigger('click');
    await w.find('[data-testid="field-name-0"]').setValue('headline');

    await w.find('form').trigger('submit');
    await flushPromises();

    expect(updateSpy).toHaveBeenCalled();
    const payload = updateSpy.mock.calls[0]![1];
    expect(payload.fields[0]).toMatchObject({ name: 'headline', previousName: 'title' });
    // Second field unchanged → no previousName key.
    expect(payload.fields[1]!.previousName).toBeUndefined();
  });

  it('newly added fields submit without a previousName', async () => {
    const createSpy = vi.spyOn(client.api, 'createBlueprint').mockResolvedValue({
      handle: 'pages',
      label: 'Pages',
      singleton: false,
      fields: [],
    });
    const w = mountEditor(null);
    await flushPromises();

    await w.find('[data-testid="blueprint-handle"]').setValue('pages');
    await w.find('[data-testid="blueprint-label"]').setValue('Pages');
    await w.find('[data-testid="add-field"]').trigger('click');
    await w.find('[data-testid="field-name-0"]').setValue('title');

    await w.find('form').trigger('submit');
    await flushPromises();

    expect(createSpy).toHaveBeenCalled();
    const payload = createSpy.mock.calls[0]![0];
    expect(payload.fields[0]).toMatchObject({ name: 'title' });
    expect((payload.fields[0] as unknown as Record<string, unknown>).previousName).toBeUndefined();
  });

  it('auto-slugifies handle from label in create mode', async () => {
    const w = mountEditor(null);
    await flushPromises();
    await w.find('[data-testid="blueprint-label"]').setValue('My Cool Pages');
    expect((w.find('[data-testid="blueprint-handle"]').element as HTMLInputElement).value).toBe(
      'my-cool-pages',
    );
  });

  it('locks the handle once the user clicks Edit, and stops auto-syncing', async () => {
    const w = mountEditor(null);
    await flushPromises();
    await w.find('[data-testid="blueprint-label"]').setValue('Pages');
    expect((w.find('[data-testid="blueprint-handle"]').element as HTMLInputElement).value).toBe(
      'pages',
    );
    await w.find('[data-testid="handle-edit"]').trigger('click');
    await w.find('[data-testid="blueprint-handle"]').setValue('my-pages');
    await w.find('[data-testid="blueprint-label"]').setValue('Pages Renamed');
    // Handle stays at the user-edited value.
    expect((w.find('[data-testid="blueprint-handle"]').element as HTMLInputElement).value).toBe(
      'my-pages',
    );
  });

  it('reset returns handle to the slugified label', async () => {
    const w = mountEditor(null);
    await flushPromises();
    await w.find('[data-testid="blueprint-label"]').setValue('Pages');
    await w.find('[data-testid="handle-edit"]').trigger('click');
    await w.find('[data-testid="blueprint-handle"]').setValue('something-else');
    await w.find('[data-testid="handle-reset"]').trigger('click');
    expect((w.find('[data-testid="blueprint-handle"]').element as HTMLInputElement).value).toBe(
      'pages',
    );
    // After reset, typing into Label should sync again.
    await w.find('[data-testid="blueprint-label"]').setValue('Posts');
    expect((w.find('[data-testid="blueprint-handle"]').element as HTMLInputElement).value).toBe(
      'posts',
    );
  });

  it('shows an empty-state card and disables Save when there are no fields', async () => {
    const w = mountEditor(null);
    await flushPromises();
    expect(w.find('[data-testid="fields-empty-state"]').exists()).toBe(true);
    expect((w.find('[data-testid="blueprint-save"]').element as HTMLButtonElement).disabled).toBe(
      true,
    );
    // Adding a field removes the empty state and enables Save.
    await w.find('[data-testid="add-field"]').trigger('click');
    expect(w.find('[data-testid="fields-empty-state"]').exists()).toBe(false);
    expect((w.find('[data-testid="blueprint-save"]').element as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('emits a success toast on save', async () => {
    vi.spyOn(client.api, 'updateBlueprint').mockResolvedValue({
      handle: 'posts',
      label: 'Posts',
      singleton: false,
      fields: [],
    });
    const w = mountEditor('posts');
    await flushPromises();
    // Editor is in edit mode with 2 fields preloaded — Save is enabled.
    await w.find('form').trigger('submit');
    await flushPromises();

    // Inspect the toasts store directly to avoid coupling to <Toasts /> markup,
    // which is not mounted in this isolated component test.
    const { useToastsStore } = await import('../../stores/toasts.js');
    const toasts = useToastsStore();
    expect(toasts.list.map((t) => ({ kind: t.kind, message: t.message }))).toEqual([
      { kind: 'success', message: 'Schema saved' },
    ]);
  });
});
