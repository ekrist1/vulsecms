import type { Component } from 'vue';

export type SiteManifestRouteKind = 'page' | 'list' | 'entry';

export interface SiteManifestRoute {
  path: string;
  kind: SiteManifestRouteKind;
  component: Component;
  layout: string;
  collection?: string;
  source?: string;
}

export interface SiteRouteManifest {
  routes: SiteManifestRoute[];
  hasProjectRoutes: boolean;
}

export interface SiteRouteMatch {
  route: SiteManifestRoute;
  params: Record<string, string>;
}

export const emptySiteRouteManifest: SiteRouteManifest = {
  routes: [],
  hasProjectRoutes: false,
};

function normalizePath(pathname: string): string {
  if (pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function split(pathname: string): string[] {
  return normalizePath(pathname)
    .split('/')
    .filter((part) => part.length > 0);
}

export function matchManifestRoute(
  manifest: SiteRouteManifest | undefined,
  pathname: string,
): SiteRouteMatch | null {
  const routes = manifest?.routes ?? [];
  const current = split(decodeURIComponent(pathname));

  for (const route of routes) {
    const candidate = split(route.path);
    if (candidate.length !== current.length) continue;

    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < candidate.length; i += 1) {
      const routePart = candidate[i]!;
      const value = current[i]!;
      if (routePart.startsWith(':')) {
        params[routePart.slice(1)] = value;
      } else if (routePart !== value) {
        matched = false;
        break;
      }
    }

    if (matched) return { route, params };
  }

  return null;
}
