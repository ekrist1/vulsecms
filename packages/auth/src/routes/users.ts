import type { DatabaseAdapter } from '@vulse/db';
import {
  type Router,
  createRouter,
  defineEventHandler,
  getQuery,
  getRouterParam,
  readBody,
  setResponseStatus,
} from 'h3';
import { withSuper } from '../middleware/require-super.js';
import {
  type CreateUserOptions,
  createUser,
  deleteUser,
  getUser,
  listUsers,
  updateUser,
} from '../services/users.js';

export interface UsersRouteOptions {
  onUserCreated?: CreateUserOptions['onCreated'];
}

export function usersRoute(adapter: DatabaseAdapter, options: UsersRouteOptions = {}): Router {
  const router = createRouter();

  router.get(
    '/api/users',
    withSuper(
      defineEventHandler(async (event) => {
        const query = getQuery(event);
        const limit = Number(query.limit ?? '50');
        const offset = Number(query.offset ?? '0');
        const role = query.role as 'editor' | 'external_user' | undefined;
        return await listUsers(adapter, { limit, offset, ...(role ? { role } : {}) });
      }),
    ),
  );
  router.post(
    '/api/users',
    withSuper(
      defineEventHandler(async (event) => {
        const body = await readBody(event);
        const out = await createUser(adapter, body, {
          ...(options.onUserCreated ? { onCreated: options.onUserCreated } : {}),
        });
        setResponseStatus(event, 201);
        return out;
      }),
    ),
  );
  router.get(
    '/api/users/:id',
    withSuper(
      defineEventHandler(async (event) => {
        const id = getRouterParam(event, 'id') as string;
        const u = await getUser(adapter, id);
        if (!u) {
          setResponseStatus(event, 404);
          return { error: 'not_found' };
        }
        return u;
      }),
    ),
  );
  router.patch(
    '/api/users/:id',
    withSuper(
      defineEventHandler(async (event) => {
        const id = getRouterParam(event, 'id') as string;
        const body = await readBody(event);
        return await updateUser(adapter, id, body);
      }),
    ),
  );
  router.delete(
    '/api/users/:id',
    withSuper(
      defineEventHandler(async (event) => {
        const id = getRouterParam(event, 'id') as string;
        await deleteUser(adapter, id);
        setResponseStatus(event, 204);
        return null;
      }),
    ),
  );
  return router;
}
