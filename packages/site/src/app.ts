import { createSSRApp } from 'vue';
import App from './App.vue';
import { createSiteRouter } from './router.js';
import { SITE_STATE_KEY, defaultState } from './state.js';
import type { SiteInitialState } from './types.js';

export interface CreateSiteAppOptions {
  history: 'memory' | 'web';
  initialState?: SiteInitialState;
}

export function createSiteApp(options: CreateSiteAppOptions) {
  const initialState = options.initialState ?? defaultState();
  const app = createSSRApp(App);
  const router = createSiteRouter(options.history, initialState.blueprints);

  app.provide(SITE_STATE_KEY, initialState);
  app.use(router);

  return { app, router };
}
