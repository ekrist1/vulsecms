import type { ImageModifiers } from '@vulse/image/url';
import { createSSRApp } from 'vue';
import App from './App.vue';
import DefaultLayout from './layouts/DefaultLayout.vue';
import { createSiteRouter } from './router.js';
import { SITE_LAYOUTS_KEY, type SiteLayoutRegistry } from './runtime/layouts.js';
import type { SiteRouteManifest } from './runtime/manifest.js';
import { SITE_STATE_KEY, defaultState } from './state.js';
import type { SiteInitialState } from './types.js';

export interface SiteImageUrlBuilderInput {
  assetId: string;
  mods: ImageModifiers;
  originalExt?: string;
}

export type SiteImageUrlBuilder = (input: SiteImageUrlBuilderInput) => string;

export interface CreateSiteAppOptions {
  history: 'memory' | 'web';
  initialState?: SiteInitialState;
  imageSecret?: string;
  imageUrlBuilder?: SiteImageUrlBuilder;
  manifest?: SiteRouteManifest;
  layouts?: SiteLayoutRegistry;
}

export function createSiteApp(options: CreateSiteAppOptions) {
  const initialState = options.initialState ?? defaultState();
  const app = createSSRApp(App);
  const router = createSiteRouter(options.history, initialState.blueprints, options.manifest);
  const layouts = { default: DefaultLayout, ...(options.layouts ?? {}) };

  app.provide(SITE_STATE_KEY, initialState);
  app.provide(SITE_LAYOUTS_KEY, layouts);
  app.provide('vulse:imageSecret', options.imageSecret ?? '');
  app.provide('vulse:buildImageUrl', options.imageUrlBuilder ?? null);
  app.use(router);

  return { app, router };
}
