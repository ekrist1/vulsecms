import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import CollectionList from './pages/CollectionList.vue';
import CollectionEntry from './pages/CollectionEntry.vue';
import BlueprintList from './pages/BlueprintList.vue';
import BlueprintEditor from './pages/BlueprintEditor.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/loading' },
  { path: '/loading', component: { template: '<div class="p-8 text-zinc-500">Loading…</div>' } },
  { path: '/collections/:handle', component: CollectionList, props: true },
  {
    path: '/collections/:handle/new',
    component: CollectionEntry,
    props: (r) => ({ handle: r.params.handle, id: null }),
  },
  { path: '/collections/:handle/:id', component: CollectionEntry, props: true },
  { path: '/schema', component: BlueprintList },
  { path: '/schema/new', component: BlueprintEditor, props: () => ({ handle: null }) },
  { path: '/schema/:handle', component: BlueprintEditor, props: true },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
