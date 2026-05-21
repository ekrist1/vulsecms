import type { AuthInstance } from '@vulse/auth';
import type {
  Blueprint,
  BlueprintMeta,
  ContentService,
  Entry,
  FieldFilter,
  GlobalService,
  PublicGlobals,
  SortSpec,
} from '@vulse/core';
import type { SiteLayoutRegistry } from './runtime/layouts.js';
import type { SiteRouteManifest } from './runtime/manifest.js';

export interface SiteRouteOverride {
  collection: string;
  id?: string;
  slug?: string;
  list?: boolean;
  layout?: string;
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
  /**
   * Optional hook to convert the raw entry image value (string URL or object)
   * into a final absolute URL. If undefined, only string values are passed
   * through.
   */
  resolveImage?: (raw: unknown, site: SiteConfig) => string | undefined;
  frontend?: {
    dir?: string;
  };
  routes?: SiteRouteOverrides;
  scripts?: SiteScript[];
  seo?: SiteSeoConfig;
  /** HMAC secret for signing image URLs. Provided to the Vue app via `vulse:imageSecret`. */
  imageSecret?: string;
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
  type: 'landing' | 'page' | 'entry' | 'list' | 'not-found';
  layout: string;
  collection?: string | undefined;
  slug?: string | undefined;
}

export interface SiteInitialState {
  route: SiteRouteState;
  blueprints: BlueprintMeta[];
  globals: PublicGlobals;
  entry: Entry | null;
  entries: Entry[];
}

export interface SiteServerDeps {
  blueprints: Map<string, Blueprint>;
  content: ContentService;
  globals?: GlobalService;
  /** @deprecated Use site.routes instead. Kept for existing Vulse apps. */
  routes?: SiteRouteOverrides;
  site?: SiteConfig;
  authInstance?: AuthInstance;
  previewSecret?: string;
  manifest?: SiteRouteManifest;
  layouts?: SiteLayoutRegistry;
  render?: Pick<RenderPageOptions, 'clientEntry' | 'stylesheet' | 'environment'>;
}

export interface RenderPageOptions {
  clientEntry?: string;
  stylesheet?: string;
  site?: SiteConfig;
  requestUrl?: string | URL;
  environment?: string;
  manifest?: SiteRouteManifest;
  layouts?: SiteLayoutRegistry;
}
