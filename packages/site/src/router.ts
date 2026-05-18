import type { BlueprintMeta } from '@vulse/core';
import {
  type RouteRecordRaw,
  createMemoryHistory,
  createRouter,
  createWebHistory,
} from 'vue-router';
import Default from './views/Default.vue';
import NotFound from './views/NotFound.vue';
import PageDetail from './views/PageDetail.vue';
import PostDetail from './views/PostDetail.vue';
import PostList from './views/PostList.vue';

function collectionRoutes(blueprints: BlueprintMeta[]): RouteRecordRaw[] {
  return blueprints
    .filter((blueprint) => !blueprint.singleton && blueprint.handle !== 'pages')
    .flatMap((blueprint) => [
      {
        path: `/${blueprint.handle}`,
        component: PostList,
      },
      {
        path: `/${blueprint.handle}/:slug`,
        component: PostDetail,
      },
    ]);
}

export function createSiteRoutes(blueprints: BlueprintMeta[] = []): RouteRecordRaw[] {
  return [
    { path: '/', component: Default },
    ...collectionRoutes(blueprints),
    { path: '/:slug', component: PageDetail },
    { path: '/:handle', component: PostList },
    { path: '/:handle/:slug', component: PostDetail },
    { path: '/:pathMatch(.*)*', component: NotFound },
  ];
}

export function createSiteRouter(history: 'memory' | 'web', blueprints: BlueprintMeta[] = []) {
  return createRouter({
    history: history === 'memory' ? createMemoryHistory() : createWebHistory(),
    routes: createSiteRoutes(blueprints),
  });
}
