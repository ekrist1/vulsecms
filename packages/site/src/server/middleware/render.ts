import { fileURLToPath } from 'node:url';
import {
  type App,
  type EventHandler,
  createApp,
  defineEventHandler,
  getRequestURL,
  setResponseHeader,
  setResponseStatus,
} from 'h3';
import { findPublicEntryBySlug, getPublicEntryById } from '../../composables/useEntry.js';
import { renderPage } from '../../entry-server.js';
import type { SiteInitialState, SiteRouteOverride, SiteServerDeps } from '../../types.js';

export const SITE_CLIENT_BASE = '/_vulse/site/';
export type { SiteRouteOverrides } from '../../types.js';

export function resolveSiteClientRoot(): string {
  return fileURLToPath(new URL('../../client/', import.meta.url));
}

function toMeta(blueprint: SiteServerDeps['blueprints'] extends Map<string, infer T> ? T : never) {
  return {
    handle: blueprint.handle,
    label: blueprint.label,
    singleton: blueprint.singleton,
    tree: blueprint.tree,
    ...(blueprint.maxDepth !== undefined ? { maxDepth: blueprint.maxDepth } : {}),
    fields: blueprint.fields,
  };
}

function normalizePath(pathname: string): string {
  if (pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function toRouteKey(pathname: string): string {
  return normalizePath(decodeURIComponent(pathname));
}

function segments(pathname: string): string[] {
  return normalizePath(pathname)
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(decodeURIComponent);
}

function includeProtected(url: URL): boolean {
  return url.searchParams.get('preview') === '1';
}

async function resolveOverride(
  deps: SiteServerDeps,
  override: SiteRouteOverride,
  preview: boolean,
): Promise<SiteInitialState> {
  const blueprints = [...deps.blueprints.values()].map(toMeta);
  if (override.list) {
    const result = await deps.content.list(override.collection, {
      limit: 100,
      includeProtected: preview,
    });
    return {
      route: { type: 'list', collection: override.collection },
      blueprints,
      entry: null,
      entries: result.items,
    };
  }

  const entry = override.id
    ? await getPublicEntryById(deps.content, override.collection, override.id, {
        includeProtected: preview,
      })
    : override.slug
      ? await findPublicEntryBySlug(deps.content, override.collection, override.slug, {
          includeProtected: preview,
        })
      : null;

  return {
    route: {
      type: entry ? 'entry' : 'not-found',
      collection: override.collection,
      slug: override.slug,
    },
    blueprints,
    entry,
    entries: [],
  };
}

export async function resolveSiteRequest(
  deps: SiteServerDeps,
  url: URL,
): Promise<{ status: number; state: SiteInitialState }> {
  const blueprints = [...deps.blueprints.values()].map(toMeta);
  const preview = includeProtected(url);
  const pathname = toRouteKey(url.pathname);
  const override = deps.routes?.[pathname];
  if (override) {
    const state = await resolveOverride(deps, override, preview);
    return { status: state.route.type === 'not-found' ? 404 : 200, state };
  }

  const parts = segments(pathname);
  if (parts.length === 0) {
    if (deps.blueprints.has('home')) {
      const result = await deps.content.list('home', { limit: 1, includeProtected: preview });
      const entry = result.items[0] ?? null;
      return {
        status: entry ? 200 : 200,
        state: {
          route: { type: entry ? 'entry' : 'landing', collection: 'home' },
          blueprints,
          entry,
          entries: [],
        },
      };
    }

    return {
      status: 200,
      state: { route: { type: 'landing' }, blueprints, entry: null, entries: [] },
    };
  }

  if (parts.length === 1) {
    const [slugOrHandle] = parts;
    if (slugOrHandle && deps.blueprints.has(slugOrHandle)) {
      const result = await deps.content.list(slugOrHandle, {
        limit: 100,
        includeProtected: preview,
      });
      return {
        status: 200,
        state: {
          route: { type: 'list', collection: slugOrHandle },
          blueprints,
          entry: null,
          entries: result.items,
        },
      };
    }

    if (slugOrHandle && deps.blueprints.has('pages')) {
      const entry = await findPublicEntryBySlug(deps.content, 'pages', slugOrHandle, {
        includeProtected: preview,
      });
      return {
        status: entry ? 200 : 404,
        state: {
          route: { type: entry ? 'entry' : 'not-found', collection: 'pages', slug: slugOrHandle },
          blueprints,
          entry,
          entries: [],
        },
      };
    }
  }

  if (parts.length === 2) {
    const [collection, slug] = parts;
    if (collection && slug && deps.blueprints.has(collection)) {
      const entry = await findPublicEntryBySlug(deps.content, collection, slug, {
        includeProtected: preview,
      });
      return {
        status: entry ? 200 : 404,
        state: {
          route: { type: entry ? 'entry' : 'not-found', collection, slug },
          blueprints,
          entry,
          entries: [],
        },
      };
    }
  }

  return {
    status: 404,
    state: { route: { type: 'not-found' }, blueprints, entry: null, entries: [] },
  };
}

export function createSiteRenderer(deps: SiteServerDeps): EventHandler {
  return defineEventHandler(async (event) => {
    const url = getRequestURL(event);
    const { status, state } = await resolveSiteRequest(deps, url);
    setResponseStatus(event, status);
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
    return await renderPage(`${url.pathname}${url.search}`, state);
  });
}

export function createSiteServer(deps: SiteServerDeps): App {
  const app = createApp();
  app.use(createSiteRenderer(deps));
  return app;
}
