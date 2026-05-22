import type { Component, InjectionKey } from 'vue';

export type SiteLayoutRegistry = Record<string, Component>;

export const SITE_LAYOUTS_KEY: InjectionKey<SiteLayoutRegistry> = Symbol.for('vulse:site-layouts');
