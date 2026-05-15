import type { InjectionKey } from 'vue';
import type { BlockComponentMap } from './types.js';

export const COMPONENTS_KEY: InjectionKey<BlockComponentMap> = Symbol('vulse:components');
