import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../api/client.js';
import { useAuthStore } from '../auth.js';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('useAuthStore', () => {
  it('hydrate() populates user + perms', async () => {
    vi.spyOn(client.api, 'me').mockResolvedValue({
      user: { id: 'u1', email: 'a@b.com', name: null, role: 'editor', isSuper: true },
      perms: { posts: ['read', 'update'] },
    });
    const s = useAuthStore();
    await s.hydrate();
    expect(s.user?.id).toBe('u1');
    expect(s.perms.posts).toEqual(['read', 'update']);
    expect(s.hydrated).toBe(true);
  });

  it('can(handle, action) returns true for super users', () => {
    const s = useAuthStore();
    s.user = { id: 'u1', email: 'x', name: null, role: 'editor', isSuper: true };
    s.perms = {};
    expect(s.can('posts', 'delete')).toBe(true);
  });

  it('can() reads perms map for non-super', () => {
    const s = useAuthStore();
    s.user = { id: 'u2', email: 'x', name: null, role: 'editor', isSuper: false };
    s.perms = { posts: ['read'] };
    expect(s.can('posts', 'read')).toBe(true);
    expect(s.can('posts', 'delete')).toBe(false);
    expect(s.can('unknown', 'read')).toBe(false);
  });

  it('logout() clears user and perms', async () => {
    vi.spyOn(client.api, 'logout').mockResolvedValue();
    const s = useAuthStore();
    s.user = { id: 'u', email: 'x', name: null, role: 'editor', isSuper: false };
    s.perms = { posts: ['read'] };
    await s.logout();
    expect(s.user).toBeNull();
    expect(s.perms).toEqual({});
  });
});
