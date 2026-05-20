import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import * as client from '../../api/client.js';
import LoginPage from '../LoginPage.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: { template: '<div/>' } },
    { path: '/login', component: LoginPage },
    { path: '/forgot-password', component: { template: '<div/>' } },
  ],
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('LoginPage', () => {
  it('signs in and navigates to / on success', async () => {
    const loginSpy = vi.spyOn(client.api, 'login').mockResolvedValue();
    vi.spyOn(client.api, 'me').mockResolvedValue({
      user: { id: 'u', email: 'a@b.com', name: null, role: 'editor', isSuper: true },
      perms: {},
    });
    router.push('/login');
    await router.isReady();
    const w = mount(LoginPage, { global: { plugins: [router] } });
    await w.find('[data-testid="login-email"]').setValue('a@b.com');
    await w.find('[data-testid="login-password"]').setValue('hunter2hunter2');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(loginSpy).toHaveBeenCalledWith('a@b.com', 'hunter2hunter2');
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('shows error on invalid credentials', async () => {
    vi.spyOn(client.api, 'login').mockRejectedValue({
      response: { message: 'Invalid credentials' },
    });
    router.push('/login');
    await router.isReady();
    const w = mount(LoginPage, { global: { plugins: [router] } });
    await w.find('[data-testid="login-email"]').setValue('a@b.com');
    await w.find('[data-testid="login-password"]').setValue('wrong');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('[data-testid="login-error"]').text()).toContain('Invalid credentials');
  });

  it('refuses external_user accounts and signs them out', async () => {
    vi.spyOn(client.api, 'login').mockResolvedValue();
    const logoutSpy = vi.spyOn(client.api, 'logout').mockResolvedValue();
    vi.spyOn(client.api, 'me').mockResolvedValue({
      user: { id: 'u', email: 'a@b.com', name: null, role: 'external_user', isSuper: false },
      perms: {},
    });
    router.push('/login');
    await router.isReady();
    const w = mount(LoginPage, { global: { plugins: [router] } });
    await w.find('[data-testid="login-email"]').setValue('a@b.com');
    await w.find('[data-testid="login-password"]').setValue('hunter2hunter2');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(logoutSpy).toHaveBeenCalled();
    expect(w.find('[data-testid="login-error"]').text()).toContain('cannot access the admin');
  });
});
