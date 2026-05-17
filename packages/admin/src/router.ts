import { type RouteRecordRaw, createRouter, createWebHistory } from 'vue-router';
import BlueprintEditor from './pages/BlueprintEditor.vue';
import BlueprintList from './pages/BlueprintList.vue';
import CollectionEntry from './pages/CollectionEntry.vue';
import CollectionList from './pages/CollectionList.vue';
import ForgotPasswordPage from './pages/ForgotPasswordPage.vue';
import LoginPage from './pages/LoginPage.vue';
import ResetPasswordPage from './pages/ResetPasswordPage.vue';
import { useAuthStore } from './stores/auth.js';

const routes: RouteRecordRaw[] = [
  { path: '/login', component: LoginPage, meta: { requiresAuth: false } },
  { path: '/forgot-password', component: ForgotPasswordPage, meta: { requiresAuth: false } },
  { path: '/reset-password/:token', component: ResetPasswordPage, meta: { requiresAuth: false } },
  { path: '/', redirect: '/loading' },
  { path: '/loading', component: { template: '<div class="p-8 text-zinc-500">Loading…</div>' }, meta: { requiresAuth: true } },
  { path: '/collections/:handle', component: CollectionList, props: true, meta: { requiresAuth: true } },
  {
    path: '/collections/:handle/new',
    component: CollectionEntry,
    props: (r) => ({ handle: r.params.handle, id: null }),
    meta: { requiresAuth: true },
  },
  { path: '/collections/:handle/:id', component: CollectionEntry, props: true, meta: { requiresAuth: true } },
  { path: '/schema', component: BlueprintList, meta: { requiresAuth: true } },
  { path: '/schema/new', component: BlueprintEditor, props: () => ({ handle: null }), meta: { requiresAuth: true, requiresSuper: true } },
  { path: '/schema/:handle', component: BlueprintEditor, props: true, meta: { requiresAuth: true, requiresSuper: true } },
  { path: '/settings/users', component: () => import('./pages/UserList.vue'), meta: { requiresAuth: true, requiresSuper: true } },
  { path: '/settings/users/new', component: () => import('./pages/UserEditor.vue'), props: () => ({ id: null }), meta: { requiresAuth: true, requiresSuper: true } },
  { path: '/settings/users/:id', component: () => import('./pages/UserEditor.vue'), props: true, meta: { requiresAuth: true, requiresSuper: true } },
  { path: '/settings/groups', component: () => import('./pages/GroupList.vue'), meta: { requiresAuth: true, requiresSuper: true } },
  { path: '/settings/groups/new', component: () => import('./pages/GroupEditor.vue'), props: () => ({ handle: null }), meta: { requiresAuth: true, requiresSuper: true } },
  { path: '/settings/groups/:handle', component: () => import('./pages/GroupEditor.vue'), props: true, meta: { requiresAuth: true, requiresSuper: true } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.hydrated) {
    try { await auth.hydrate(); } catch { /* ignore */ }
  }
  if (to.meta.requiresAuth !== false && !auth.user) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.meta.requiresSuper && !auth.user?.isSuper) {
    return { path: '/' };
  }
});
