import '@vulse/renderer/styles';
import { projectLayouts, projectRoutes } from 'virtual:vulse-site-manifest';
import { createSiteApp } from './app.js';
import { defaultState } from './state.js';
import './style.css';
import type { SiteInitialState } from './types.js';

declare global {
  interface Window {
    __VULSE_SITE_STATE__?: SiteInitialState;
  }
}

const initialState = window.__VULSE_SITE_STATE__ ?? defaultState();
const { app, router } = createSiteApp({
  history: 'web',
  initialState,
  layouts: projectLayouts,
  manifest: { routes: projectRoutes, hasProjectRoutes: projectRoutes.length > 0 },
});

router.isReady().then(() => {
  app.mount('#app', true);
});
