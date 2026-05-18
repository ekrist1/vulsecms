import type { DatabaseAdapter } from '@vulse/db';
import {
  type Router,
  createRouter,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
} from 'h3';
import { withSuper } from '../middleware/require-super.js';
import {
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  setPermissions,
  updateGroup,
} from '../services/groups.js';

export function groupsRoute(adapter: DatabaseAdapter): Router {
  const router = createRouter();

  router.get('/api/groups', withSuper(defineEventHandler(async () => await listGroups(adapter))));
  router.post(
    '/api/groups',
    withSuper(
      defineEventHandler(async (event) => {
        const body = await readBody(event);
        const out = await createGroup(adapter, body);
        setResponseStatus(event, 201);
        return out;
      }),
    ),
  );
  router.get(
    '/api/groups/:handle',
    withSuper(
      defineEventHandler(async (event) => {
        const handle = getRouterParam(event, 'handle') as string;
        const g = await getGroup(adapter, handle);
        if (!g) {
          setResponseStatus(event, 404);
          return { error: 'not_found' };
        }
        return g;
      }),
    ),
  );
  router.patch(
    '/api/groups/:handle',
    withSuper(
      defineEventHandler(async (event) => {
        const handle = getRouterParam(event, 'handle') as string;
        const body = await readBody(event);
        const g = await getGroup(adapter, handle);
        if (!g) {
          setResponseStatus(event, 404);
          return { error: 'not_found' };
        }
        await updateGroup(adapter, g.id, body);
        return await getGroup(adapter, g.handle);
      }),
    ),
  );
  router.put(
    '/api/groups/:handle/permissions',
    withSuper(
      defineEventHandler(async (event) => {
        const handle = getRouterParam(event, 'handle') as string;
        const body = (await readBody(event)) as { rows: Parameters<typeof setPermissions>[2] };
        const g = await getGroup(adapter, handle);
        if (!g) {
          setResponseStatus(event, 404);
          return { error: 'not_found' };
        }
        await setPermissions(adapter, g.id, body.rows);
        return await getGroup(adapter, g.handle);
      }),
    ),
  );
  router.delete(
    '/api/groups/:handle',
    withSuper(
      defineEventHandler(async (event) => {
        const handle = getRouterParam(event, 'handle') as string;
        const g = await getGroup(adapter, handle);
        if (!g) {
          setResponseStatus(event, 404);
          return { error: 'not_found' };
        }
        await deleteGroup(adapter, g.id);
        setResponseStatus(event, 204);
        return null;
      }),
    ),
  );
  return router;
}
