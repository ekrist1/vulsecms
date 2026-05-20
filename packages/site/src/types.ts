import type { AuthInstance } from '@vulse/auth';
import type {
  Blueprint,
  BlueprintMeta,
  ContentService,
  Entry,
  FieldFilter,
  SortSpec,
} from '@vulse/core';

export interface SiteRouteOverride {
  collection: string;
  id?: string;
  slug?: string;
  list?: boolean;
  filter?: Record<string, FieldFilter>;
  sort?: SortSpec[];
}

export type SiteRouteOverrides = Record<string, SiteRouteOverride>;

export interface SiteSeoConfig {
  robots?: string;
  twitterCard?: 'summary' | 'summary_large_image';
}

export interface SiteScript {
  id: string;
  position: 'head' | 'bodyOpen' | 'bodyClose';
  src?: string;
  content?: string;
  attrs?: Record<string, string | boolean>;
  noscript?: string;
  productionOnly?: boolean;
}

export interface SiteConfig {
  url?: string;
  name?: string;
  locale?: string;
  titleTemplate?: string;
  defaultTitle?: string;
  defaultDescription?: string;
  defaultImage?: string;
  routes?: SiteRouteOverrides;
  scripts?: SiteScript[];
  seo?: SiteSeoConfig;
}

export interface HeadMetaTag {
  name?: string;
  property?: string;
  content: string;
}

export interface HeadLinkTag {
  rel: string;
  href: string;
}

export interface ResolvedHead {
  htmlAttrs: Record<string, string>;
  title: string;
  meta: HeadMetaTag[];
  links: HeadLinkTag[];
  scripts: SiteScript[];
  jsonLd: unknown[];
}

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
  /** @deprecated Use site.routes instead. Kept for existing Vulse apps. */
  routes?: SiteRouteOverrides;
  site?: SiteConfig;
  authInstance?: AuthInstance;
  previewSecret?: string;
}

export interface RenderPageOptions {
  clientEntry?: string;
  stylesheet?: string;
  site?: SiteConfig;
  requestUrl?: string | URL;
  environment?: string;
}
