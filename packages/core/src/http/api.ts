import {
  type AuthInstance,
  effectivePerms,
  groupsRoute,
  meRoute,
  sessionMiddleware,
  usersRoute,
  withPerm,
  withSuper,
} from '@vulse/auth';
import type { DatabaseAdapter, DatabaseConfigSummary } from '@vulse/db';
import {
  type App,
  type H3Event,
  appendResponseHeader,
  createApp,
  createRouter,
  defineEventHandler,
  getQuery,
  getRequestHeader,
  getRequestURL,
  getRequestWebStream,
  getRouterParam,
  readBody,
  setResponseStatus,
} from 'h3';
import { assetRoutes } from '../assets/routes.js';
import {
  BlueprintDefinitionSchema,
  BlueprintDefinitionWithRenamesSchema,
} from '../blueprints/definition.js';
import { createBlueprint, deleteBlueprint, updateBlueprint } from '../blueprints/mutations.js';
import type { Blueprint } from '../blueprints/types.js';
import type { ContentService } from '../content/types.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { getRevision, listRevisions } from '../revisions/service.js';
import type { CompiledSet } from '../sets/compile.js';
import { toMeta } from './meta.js';
import { safe } from './safe.js';
import { setsRoute } from './sets.js';

export interface ApiDeps {
  blueprints: Map<string, Blueprint>;
  content: ContentService;
  adapter: DatabaseAdapter;
  authInstance: AuthInstance;
  databaseSummary?: DatabaseConfigSummary;
  sets?: Map<string, CompiledSet>;
}

function deny(event: Parameters<typeof setResponseStatus>[0], status: number, body: object) {
  setResponseStatus(event, status);
  return body;
}

/**
 * Parse a `parent_id` query value into the content-service shape:
 *   undefined → no filter
 *   'root'   → null (root-level entries only)
 *   <ulid>   → that parent's children
 */
function parseParentIdQuery(raw: string | string[] | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  if (value === 'root' || value === '') return null;
  return value;
}

// Build a Web Request for Better Auth. h3's `toWebRequest` attaches a body
// stream for every POST/PATCH/PUT/DELETE even when there's no body, which
// makes Better Auth's body parser return 415 on bodyless requests (e.g.
// /api/auth/sign-out). Strip the body when content-length is 0/absent.
function buildWebRequest(event: H3Event): Request {
  if (event.web?.request) return event.web.request;
  const url = getRequestURL(event);
  const contentLength = getRequestHeader(event, 'content-length');
  const hasBody =
    (event.method === 'POST' ||
      event.method === 'PATCH' ||
      event.method === 'PUT' ||
      event.method === 'DELETE') &&
    contentLength !== undefined &&
    contentLength !== '0';
  const init: RequestInit & { duplex?: 'half' } = {
    method: event.method,
    headers: event.headers,
  };
  if (hasBody) {
    const stream = getRequestWebStream(event);
    if (stream) {
      init.body = stream;
      init.duplex = 'half';
    }
  }
  return new Request(url, init);
}

export function createApi(deps: ApiDeps): App {
  const { blueprints, content, adapter, authInstance, databaseSummary } = deps;

  const app = createApp({
    onError: (err, event) => {
      console.error(err);
      setResponseStatus(event, 500);
      return {
        error: 'internal',
        message: err instanceof Error ? err.message : String(err),
      };
    },
  });

  // ---- CORS (echo origin, allow credentials) ----
  app.use(
    defineEventHandler((event) => {
      const origin = getRequestHeader(event, 'origin');
      if (origin) appendResponseHeader(event, 'access-control-allow-origin', origin);
      appendResponseHeader(event, 'access-control-allow-credentials', 'true');
      appendResponseHeader(event, 'vary', 'Origin');
      if (event.method === 'OPTIONS') {
        appendResponseHeader(
          event,
          'access-control-allow-methods',
          'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        );
        const reqHeaders = getRequestHeader(event, 'access-control-request-headers');
        if (reqHeaders) appendResponseHeader(event, 'access-control-allow-headers', reqHeaders);
        appendResponseHeader(event, 'access-control-max-age', 5);
        setResponseStatus(event, 204);
        return null;
      }
    }),
  );

  // ---- Session (sets event.context.user / .session) ----
  app.use(sessionMiddleware(authInstance));

  // ---- Sub-routers (auth me/users/groups, sets, assets) ----
  app.use(meRoute(adapter).handler);
  app.use(usersRoute(adapter).handler);
  app.use(groupsRoute(adapter).handler);
  app.use(setsRoute(adapter).handler);
  app.use(assetRoutes(adapter).handler);

  // ---- Better Auth wildcard ----
  app.use(
    '/api/auth',
    defineEventHandler(async (event) => {
      const request = buildWebRequest(event);
      const response = await authInstance.auth.handler(request);
      return response;
    }),
  );

  // ---- Content / blueprint / system routes ----
  const router = createRouter();

  router.get(
    '/api/public/collections/:handle',
    safe(async (event) => {
      const handle = getRouterParam(event, 'handle') as string;
      if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);

      const query = getQuery(event);
      const limit = Number(query.limit ?? '100');
      const offset = Number(query.offset ?? '0');
      const q = (query.q as string | undefined) ?? undefined;
      const field = (query.field as string | undefined) ?? undefined;
      const parentId = parseParentIdQuery(query.parent_id as string | undefined);
      return await content.list(handle, {
        limit,
        offset,
        ...(q ? { q } : {}),
        ...(field ? { field } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
        includeProtected: false,
      });
    }),
  );

  router.get(
    '/api/public/collections/:handle/tree',
    safe(async (event) => {
      const handle = getRouterParam(event, 'handle') as string;
      if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
      return await content.tree(handle, { includeProtected: false });
    }),
  );

  router.get(
    '/api/public/collections/:handle/:id',
    safe(async (event) => {
      const handle = getRouterParam(event, 'handle') as string;
      const id = getRouterParam(event, 'id') as string;
      if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);

      const entry = await content.get(handle, id);
      if (!entry || entry.protected) throw new NotFoundError('entry not found');
      return entry;
    }),
  );

  router.get(
    '/api/public/_meta/collections',
    safe(() => {
      return [...blueprints.values()].map(toMeta);
    }),
  );

  router.get(
    '/api/collections/:handle',
    safe(async (event) => {
      const handle = getRouterParam(event, 'handle') as string;
      if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
      const user = event.context.user;

      if (user && user.role === 'editor' && !user.isSuper) {
        const perms = await effectivePerms(user, adapter);
        if (!perms.get(handle)?.has('read')) return deny(event, 403, { error: 'forbidden' });
      }

      const query = getQuery(event);
      const limit = Number(query.limit ?? '100');
      const offset = Number(query.offset ?? '0');
      const q = (query.q as string | undefined) ?? undefined;
      const field = (query.field as string | undefined) ?? undefined;
      const parentId = parseParentIdQuery(query.parent_id as string | undefined);
      return await content.list(handle, {
        limit,
        offset,
        ...(q ? { q } : {}),
        ...(field ? { field } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
        includeProtected: user !== null,
      });
    }),
  );

  router.get(
    '/api/collections/:handle/tree',
    safe(async (event) => {
      const handle = getRouterParam(event, 'handle') as string;
      if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
      const user = event.context.user;

      if (user && user.role === 'editor' && !user.isSuper) {
        const perms = await effectivePerms(user, adapter);
        if (!perms.get(handle)?.has('read')) return deny(event, 403, { error: 'forbidden' });
      }

      return await content.tree(handle, { includeProtected: user !== null });
    }),
  );

  router.get(
    '/api/collections/:handle/:id',
    safe(async (event) => {
      const handle = getRouterParam(event, 'handle') as string;
      const id = getRouterParam(event, 'id') as string;
      if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
      const user = event.context.user;

      if (user && user.role === 'editor' && !user.isSuper) {
        const perms = await effectivePerms(user, adapter);
        if (!perms.get(handle)?.has('read')) return deny(event, 403, { error: 'forbidden' });
      }

      const entry = await content.get(handle, id);
      if (!entry) throw new NotFoundError('entry not found');
      if (entry.protected && !user) return deny(event, 401, { error: 'auth_required' });
      return entry;
    }),
  );

  router.post(
    '/api/collections/:handle',
    withPerm(
      { action: 'create', adapter },
      safe(async (event) => {
        const handle = getRouterParam(event, 'handle') as string;
        if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
        const input = await readBody(event);
        const userId = event.context.user?.id;
        const entry = await content.create(
          handle,
          input,
          userId ? { actor: { userId } } : undefined,
        );
        setResponseStatus(event, 201);
        return entry;
      }),
    ),
  );

  router.patch(
    '/api/collections/:handle/:id',
    withPerm(
      { action: 'update', adapter },
      safe(async (event) => {
        const handle = getRouterParam(event, 'handle') as string;
        const id = getRouterParam(event, 'id') as string;
        if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
        const input = await readBody(event);
        const userId = event.context.user?.id;
        return await content.update(handle, id, input, userId ? { actor: { userId } } : undefined);
      }),
    ),
  );

  router.delete(
    '/api/collections/:handle/:id',
    withPerm(
      { action: 'delete', adapter },
      safe(async (event) => {
        const handle = getRouterParam(event, 'handle') as string;
        const id = getRouterParam(event, 'id') as string;
        if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
        await content.delete(handle, id);
        setResponseStatus(event, 204);
        return null;
      }),
    ),
  );

  router.patch(
    '/api/collections/:handle/:id/move',
    withPerm(
      { action: 'update', adapter },
      safe(async (event) => {
        const handle = getRouterParam(event, 'handle') as string;
        const id = getRouterParam(event, 'id') as string;
        if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
        const body = (await readBody(event)) as {
          parentId?: string | null;
          sortOrder?: number;
        };
        if (!('parentId' in body)) {
          throw new ValidationError([
            {
              code: 'custom',
              message: 'parentId is required (use null for root-level placement).',
              path: ['parentId'],
            },
          ]);
        }
        return await content.move(handle, id, {
          parentId: body.parentId ?? null,
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        });
      }),
    ),
  );

  // ---- Revisions ----
  router.get(
    '/api/collections/:handle/:id/revisions',
    safe(async (event) => {
      const handle = getRouterParam(event, 'handle') as string;
      const id = getRouterParam(event, 'id') as string;
      if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
      const user = event.context.user;
      if (!user) return deny(event, 401, { error: 'auth_required' });
      if (user.role === 'editor' && !user.isSuper) {
        const perms = await effectivePerms(user, adapter);
        if (!perms.get(handle)?.has('read')) return deny(event, 403, { error: 'forbidden' });
      }
      const entry = await content.get(handle, id);
      if (!entry) throw new NotFoundError('entry not found');
      const query = getQuery(event);
      const limit = Number(query.limit ?? '50');
      const offset = Number(query.offset ?? '0');
      return await listRevisions(adapter, id, { limit, offset });
    }),
  );

  router.get(
    '/api/collections/:handle/:id/revisions/:revisionId',
    safe(async (event) => {
      const handle = getRouterParam(event, 'handle') as string;
      const id = getRouterParam(event, 'id') as string;
      const revisionId = getRouterParam(event, 'revisionId') as string;
      if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
      const user = event.context.user;
      if (!user) return deny(event, 401, { error: 'auth_required' });
      if (user.role === 'editor' && !user.isSuper) {
        const perms = await effectivePerms(user, adapter);
        if (!perms.get(handle)?.has('read')) return deny(event, 403, { error: 'forbidden' });
      }
      const revision = await getRevision(adapter, id, revisionId);
      if (!revision) throw new NotFoundError('revision not found');
      return revision;
    }),
  );

  router.post(
    '/api/collections/:handle/:id/revisions/:revisionId/restore',
    withPerm(
      { action: 'update', adapter },
      safe(async (event) => {
        const handle = getRouterParam(event, 'handle') as string;
        const id = getRouterParam(event, 'id') as string;
        const revisionId = getRouterParam(event, 'revisionId') as string;
        if (!blueprints.has(handle)) throw new NotFoundError(`unknown collection: ${handle}`);
        const revision = await getRevision(adapter, id, revisionId);
        if (!revision) throw new NotFoundError('revision not found');
        const userId = event.context.user?.id;
        return await content.update(
          handle,
          id,
          revision.content,
          userId ? { actor: { userId } } : undefined,
        );
      }),
    ),
  );

  // ---- Blueprints ----
  router.get(
    '/api/blueprints',
    safe(async (event) => {
      if (!event.context.user) return deny(event, 401, { error: 'auth_required' });
      const rows = await adapter.query<{ definition: string | null }>(
        'SELECT definition FROM collections WHERE definition IS NOT NULL ORDER BY created_at ASC',
      );
      return rows.map((r) => JSON.parse(r.definition!));
    }),
  );
  router.get(
    '/api/blueprints/:handle',
    safe(async (event) => {
      if (!event.context.user) return deny(event, 401, { error: 'auth_required' });
      const handle = getRouterParam(event, 'handle') as string;
      const row = await adapter.queryOne<{ definition: string | null }>(
        'SELECT definition FROM collections WHERE handle = ?',
        [handle],
      );
      if (!row || !row.definition) throw new NotFoundError('blueprint not found');
      return JSON.parse(row.definition);
    }),
  );
  router.post(
    '/api/blueprints',
    withSuper(
      safe(async (event) => {
        const body = await readBody(event);
        const parsed = BlueprintDefinitionSchema.safeParse(body);
        if (!parsed.success) throw new ValidationError(parsed.error.issues);
        const out = await createBlueprint(adapter, parsed.data);
        setResponseStatus(event, 201);
        return out;
      }),
    ),
  );
  router.patch(
    '/api/blueprints/:handle',
    withSuper(
      safe(async (event) => {
        const handle = getRouterParam(event, 'handle') as string;
        const body = await readBody(event);
        const parsed = BlueprintDefinitionWithRenamesSchema.safeParse(body);
        if (!parsed.success) throw new ValidationError(parsed.error.issues);
        return await updateBlueprint(adapter, handle, parsed.data);
      }),
    ),
  );
  router.delete(
    '/api/blueprints/:handle',
    withSuper(
      safe(async (event) => {
        const handle = getRouterParam(event, 'handle') as string;
        await deleteBlueprint(adapter, handle);
        setResponseStatus(event, 204);
        return null;
      }),
    ),
  );

  router.get(
    '/api/_meta/collections',
    safe((event) => {
      if (!event.context.user) return deny(event, 401, { error: 'auth_required' });
      return [...blueprints.values()].map(toMeta);
    }),
  );

  router.get(
    '/api/_system/database',
    safe((event) => {
      const user = event.context.user;
      if (!user) return deny(event, 401, { error: 'auth_required' });
      if (!user.isSuper) return deny(event, 403, { error: 'forbidden' });
      if (!databaseSummary) return deny(event, 404, { error: 'not_available' });
      return databaseSummary;
    }),
  );

  app.use(router.handler);

  return app;
}
