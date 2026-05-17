import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import * as client from '../../api/client.js';
import CollectionList from '../CollectionList.vue';
import { useBlueprintsStore } from '../../stores/blueprints.js';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/collections/:handle', component: { template: '<div />' } },
    { path: '/collections/:handle/new', component: { template: '<div />' } },
    { path: '/collections/:handle/:id', component: { template: '<div />' } },
  ],
});

const seedEntries = Array.from({ length: 26 }, (_, index) => ({
  id: `01KRP${String(index).padStart(3, '0')}`,
  collection: 'posts',
  parentId: null,
  sortOrder: index + 1,
  status: 'published',
  content: {
    title: index === 5 ? 'Hono routes 101' : `Post ${index + 1}`,
    slug: index === 5 ? 'hono-routes-101' : `post-${index + 1}`,
  },
  createdAt: `2026-05-${String((index % 28) + 1).padStart(2, '0')} 10:00:00`,
  updatedAt: `2026-05-${String((index % 28) + 1).padStart(2, '0')} 12:00:00`,
  protected: false,
}));

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  const store = useBlueprintsStore();
  store.map = new Map([
    [
      'posts',
      {
        handle: 'posts',
        label: 'Posts',
        singleton: false,
        fields: [
          { name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false },
          { name: 'slug', label: 'Slug', ui: { kind: 'text' }, optional: false },
        ],
      },
    ],
  ]);

  vi.spyOn(client.api, 'list').mockImplementation(async (_handle, query = {}) => {
    let filtered = seedEntries;
    const q = query.q?.toLowerCase().trim();
    if (q) {
      filtered = filtered.filter((entry) => {
        const title = String(entry.content.title).toLowerCase();
        const slug = String(entry.content.slug).toLowerCase();
        if (query.field === 'title') return title.includes(q);
        if (query.field === 'slug') return slug.includes(q);
        if (query.field === 'id') return entry.id.toLowerCase().includes(q);
        if (query.field === 'updatedAt') return entry.updatedAt.toLowerCase().includes(q);
        return (
          title.includes(q) ||
          slug.includes(q) ||
          entry.id.toLowerCase().includes(q) ||
          entry.updatedAt.toLowerCase().includes(q)
        );
      });
    }

    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mountPage() {
  return mount(CollectionList, {
    props: { handle: 'posts' },
    global: { plugins: [router] },
  });
}

describe('CollectionList', () => {
  it('renders paginated results and advances pages', async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="collection-pagination-summary"]').text()).toContain(
      'Showing 1-25 of 26',
    );
    expect(wrapper.find('[data-testid="collection-page-indicator"]').text()).toContain(
      'Page 1 of 2',
    );

    await wrapper.find('[data-testid="collection-page-next"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="collection-pagination-summary"]').text()).toContain(
      'Showing 26-26 of 26',
    );
    expect(client.api.list).toHaveBeenLastCalledWith(
      'posts',
      expect.objectContaining({ limit: 25, offset: 25 }),
    );
  });

  it('supports column toggles and scoped search', async () => {
    vi.useFakeTimers();
    const wrapper = mountPage();
    await flushPromises();

    const headers = () => wrapper.findAll('th').map((th) => th.text());
    expect(headers()).toContain('Slug');

    await wrapper.find('[data-testid="column-toggle-field:slug"]').setValue(false);
    await flushPromises();
    expect(headers()).not.toContain('Slug');

    await wrapper.find('[data-testid="collection-search-field"]').setValue('title');
    await wrapper.find('[data-testid="collection-search"]').setValue('Hono');
    vi.advanceTimersByTime(300);
    await flushPromises();

    expect(client.api.list).toHaveBeenLastCalledWith(
      'posts',
      expect.objectContaining({ q: 'Hono', field: 'title' }),
    );
    expect(wrapper.find('[data-testid="collection-pagination-summary"]').text()).toContain(
      'Showing 1-1 of 1',
    );
    expect(wrapper.text()).toContain('Hono routes 101');
  });

  it('opens the existing entry for singleton collections', async () => {
    const store = useBlueprintsStore();
    store.map = new Map([
      [
        'posts',
        {
          handle: 'posts',
          label: 'Posts',
          singleton: true,
          fields: [
            { name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false },
            { name: 'slug', label: 'Slug', ui: { kind: 'text' }, optional: false },
          ],
        },
      ],
    ]);

    const wrapper = mountPage();
    await flushPromises();

    const action = wrapper.get('[data-testid="new-entry"]');
    expect(action.text()).toBe('Open entry');
    expect(action.attributes('href')).toBe(`/collections/posts/${seedEntries[0]!.id}`);
  });
});
