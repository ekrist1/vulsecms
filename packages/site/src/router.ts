import type { BlueprintMeta } from '@vulse/core';
import {
  type RouteRecordRaw,
  createMemoryHistory,
  createRouter,
  createWebHistory,
} from 'vue-router';
import type { SiteRouteManifest } from './runtime/manifest.js';
import Default from './views/Default.vue';
import NotFound from './views/NotFound.vue';
import PageDetail from './views/PageDetail.vue';
import PostDetail from './views/PostDetail.vue';
import PostList from './views/PostList.vue';

function layoutMeta(layout = 'default') {
  return { layout };
}

function collectionRoutes(blueprints: BlueprintMeta[]): RouteRecordRaw[] {
  return blueprints
    .filter((blueprint) => !blueprint.singleton && blueprint.handle !== 'pages')
    .flatMap((blueprint) => [
      {
        path: `/${blueprint.handle}`,
        component: PostList,
        meta: layoutMeta(),
      },
      {
        path: `/${blueprint.handle}/:slug`,
        component: PostDetail,
        meta: layoutMeta(),
      },
    ]);
}

function manifestRoutes(manifest?: SiteRouteManifest): RouteRecordRaw[] {
  return (manifest?.routes ?? []).map((route) => ({
    path: route.path,
    component: route.component,
    meta: {
      ...layoutMeta(route.layout),
      kind: route.kind,
      collection: route.collection,
    },
  }));
}

export function createSiteRoutes(
  blueprints: BlueprintMeta[] = [],
  manifest?: SiteRouteManifest,
): RouteRecordRaw[] {
  return [
    ...manifestRoutes(manifest),
    { path: '/', component: Default, meta: layoutMeta() },
    ...collectionRoutes(blueprints),
    { path: '/:slug', component: PageDetail, meta: layoutMeta() },
    { path: '/:handle', component: PostList, meta: layoutMeta() },
    { path: '/:handle/:slug', component: PostDetail, meta: layoutMeta() },
    { path: '/:pathMatch(.*)*', component: NotFound, meta: layoutMeta() },
  ];
}

export function createSiteRouter(
  history: 'memory' | 'web',
  blueprints: BlueprintMeta[] = [],
  manifest?: SiteRouteManifest,
) {
  return createRouter({
    history: history === 'memory' ? createMemoryHistory() : createWebHistory(),
    routes: createSiteRoutes(blueprints, manifest),
  });
}
