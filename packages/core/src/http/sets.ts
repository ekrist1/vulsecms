import { withSuper } from '@vulse/auth';
import type { DatabaseAdapter } from '@vulse/db';
import {
  type Router,
  createRouter,
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
} from 'h3';
import { ValidationError } from '../errors.js';
import { SetDefinitionSchema } from '../sets/definition.js';
import { createSet, deleteSet, getSet, listSets, updateSet } from '../sets/service.js';
import { safe } from './safe.js';

export function setsRoute(adapter: DatabaseAdapter): Router {
  const router = createRouter();

  // Reads: any signed-in user (admin's blueprint editor needs the list).
  router.get(
    '/api/sets',
    defineEventHandler(async (event) => {
      if (!event.context.user) {
        setResponseStatus(event, 401);
        return { error: 'auth_required' };
      }
      return await listSets(adapter);
    }),
  );
  router.get(
    '/api/sets/:handle',
    defineEventHandler(async (event) => {
      if (!event.context.user) {
        setResponseStatus(event, 401);
        return { error: 'auth_required' };
      }
      const handle = getRouterParam(event, 'handle') as string;
      const out = await getSet(adapter, handle);
      if (!out) {
        setResponseStatus(event, 404);
        return { error: 'not_found' };
      }
      return out;
    }),
  );

  // Writes: super only.
  router.post(
    '/api/sets',
    withSuper(
      safe(async (event) => {
        const body = await readBody(event);
        const parsed = SetDefinitionSchema.safeParse(body);
        if (!parsed.success) throw new ValidationError(parsed.error.issues);
        const out = await createSet(adapter, parsed.data);
        setResponseStatus(event, 201);
        return out;
      }),
    ),
  );
  router.patch(
    '/api/sets/:handle',
    withSuper(
      safe(async (event) => {
        const handle = getRouterParam(event, 'handle') as string;
        const body = await readBody(event);
        return await updateSet(adapter, handle, body);
      }),
    ),
  );
  router.delete(
    '/api/sets/:handle',
    withSuper(
      safe(async (event) => {
        const handle = getRouterParam(event, 'handle') as string;
        await deleteSet(adapter, handle);
        setResponseStatus(event, 204);
        return null;
      }),
    ),
  );

  return router;
}
