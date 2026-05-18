import type { AuthInstance } from '@vulse/auth';
import type { Blueprint, BlueprintMeta, ContentService, Entry } from '@vulse/core';

export interface SiteRouteOverride {
  collection: string;
  id?: string;
  slug?: string;
  list?: boolean;
}

export type SiteRouteOverrides = Record<string, SiteRouteOverride>;

export interface SiteRouteState {
  type: 'landing' | 'entry' | 'list' | 'not-found';
  collection?: string | undefined;
  slug?: string | undefined;
}

export interface SiteInitialState {
  route: SiteRouteState;
  blueprints: BlueprintMeta[];
  entry: Entry | null;
  entries: Entry[];
}

export interface SiteServerDeps {
  blueprints: Map<string, Blueprint>;
  content: ContentService;
  routes?: SiteRouteOverrides;
  authInstance?: AuthInstance;
}

export interface RenderPageOptions {
  clientEntry?: string;
  stylesheet?: string;
}
