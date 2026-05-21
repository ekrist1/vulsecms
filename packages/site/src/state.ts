import type { InjectionKey } from 'vue';
import type { SiteInitialState } from './types.js';

export const SITE_STATE_KEY: InjectionKey<SiteInitialState> = Symbol('vulse:site-state');

export function defaultState(): SiteInitialState {
  return {
    route: { type: 'landing', layout: 'default' },
    blueprints: [],
    globals: {},
    entry: null,
    entries: [],
  };
}
