import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import * as client from '../../api/client.js';
import GroupEditor from '../GroupEditor.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/settings/groups', component: { template: '<div/>' } }],
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(client.api, 'getGroup').mockResolvedValue({
    id: 'g1', handle: 'marketing', label: 'Marketing', createdAt: '',
    permissions: [{ collectionHandle: 'posts', canRead: true, canCreate: false, canUpdate: true, canDelete: false }],
  });
  vi.spyOn(client.api, 'meta').mockResolvedValue([
    { handle: 'posts', label: 'Posts', singleton: false, fields: [] },
    { handle: 'authors', label: 'Authors', singleton: false, fields: [] },
  ]);
});

describe('GroupEditor', () => {
  it('saves the permission matrix in the expected wire shape', async () => {
    const setPerms = vi.spyOn(client.api, 'setGroupPermissions').mockResolvedValue({
      id: 'g1', handle: 'marketing', label: 'Marketing', createdAt: '', permissions: [],
    });
    vi.spyOn(client.api, 'updateGroup').mockResolvedValue({
      id: 'g1', handle: 'marketing', label: 'Marketing', createdAt: '', permissions: [],
    });
    const w = mount(GroupEditor, {
      props: { handle: 'marketing' },
      global: { plugins: [router] },
    });
    await flushPromises();
    // Toggle: enable create on posts, enable read on authors.
    await w.find('[data-testid="perm-posts-canCreate"]').setValue(true);
    await w.find('[data-testid="perm-authors-canRead"]').setValue(true);
    await w.find('[data-testid="group-save"]').trigger('click');
    await flushPromises();
    expect(setPerms).toHaveBeenCalledWith('marketing', [
      { collectionHandle: 'posts', canRead: true, canCreate: true, canUpdate: true, canDelete: false },
      { collectionHandle: 'authors', canRead: true, canCreate: false, canUpdate: false, canDelete: false },
    ]);
  });
});
