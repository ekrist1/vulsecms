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
import { z } from 'zod';
import { ValidationError } from '../errors.js';
import { safe } from '../http/safe.js';
import { presignUrl, publicUrlFor } from './presign.js';
import { buildObjectKey, createAsset, deleteAsset, getAsset, listAssets } from './service.js';
import { deleteS3Config, getS3Config, setS3Config, toPublic } from './settings.js';
import { type S3Config, S3ConfigSchema } from './types.js';

const SignBodySchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255).optional(),
  prefix: z.string().max(120).optional(),
});

const RegisterBodySchema = z.object({
  key: z.string().min(1),
  bucket: z.string().min(1),
  url: z.string().url(),
  contentType: z.string().optional().nullable(),
  size: z.number().int().nonnegative().optional().nullable(),
  originalName: z.string().optional().nullable(),
});

export function assetRoutes(adapter: DatabaseAdapter): Router {
  const router = createRouter();

  // ---- S3 settings (super only) ----
  router.get(
    '/api/settings/s3',
    defineEventHandler(async (event) => {
      const user = event.context.user;
      if (!user) {
        setResponseStatus(event, 401);
        return { error: 'auth_required' };
      }
      if (!user.isSuper) {
        setResponseStatus(event, 403);
        return { error: 'forbidden' };
      }
      const cfg = await getS3Config(adapter);
      return toPublic(cfg);
    }),
  );
  router.put(
    '/api/settings/s3',
    safe(async (event) => {
      const user = event.context.user;
      if (!user) {
        setResponseStatus(event, 401);
        return { error: 'auth_required' };
      }
      if (!user.isSuper) {
        setResponseStatus(event, 403);
        return { error: 'forbidden' };
      }
      const body = await readBody(event);
      const parsed = S3ConfigSchema.safeParse(body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);
      await setS3Config(adapter, parsed.data);
      return toPublic(parsed.data);
    }),
  );
  router.delete(
    '/api/settings/s3',
    defineEventHandler(async (event) => {
      const user = event.context.user;
      if (!user) {
        setResponseStatus(event, 401);
        return { error: 'auth_required' };
      }
      if (!user.isSuper) {
        setResponseStatus(event, 403);
        return { error: 'forbidden' };
      }
      await deleteS3Config(adapter);
      setResponseStatus(event, 204);
      return null;
    }),
  );

  // ---- Assets ----
  router.get(
    '/api/assets',
    defineEventHandler(async (event) => {
      if (!event.context.user) {
        setResponseStatus(event, 401);
        return { error: 'auth_required' };
      }
      const query = getQuery(event);
      const limit = Number(query.limit ?? '50');
      const offset = Number(query.offset ?? '0');
      return await listAssets(adapter, { limit, offset });
    }),
  );
  router.get(
    '/api/assets/:id',
    defineEventHandler(async (event) => {
      if (!event.context.user) {
        setResponseStatus(event, 401);
        return { error: 'auth_required' };
      }
      const id = getRouterParam(event, 'id') as string;
      const asset = await getAsset(adapter, id);
      if (!asset) {
        setResponseStatus(event, 404);
        return { error: 'not_found' };
      }
      return asset;
    }),
  );
  router.post(
    '/api/assets/sign',
    safe(async (event) => {
      if (!event.context.user) {
        setResponseStatus(event, 401);
        return { error: 'auth_required' };
      }
      const config = await getS3Config(adapter);
      if (!config) {
        setResponseStatus(event, 412);
        return { error: 's3_not_configured' };
      }
      const body = await readBody(event);
      const parsed = SignBodySchema.safeParse(body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);
      const key = buildObjectKey(parsed.data.filename, parsed.data.prefix);
      const uploadUrl = presignUrl({
        config,
        method: 'PUT',
        key,
        ...(parsed.data.contentType ? { contentType: parsed.data.contentType } : {}),
      });
      return {
        key,
        bucket: config.bucket,
        uploadUrl,
        publicUrl: publicUrlFor(config, key),
        requiredHeaders: parsed.data.contentType ? { 'content-type': parsed.data.contentType } : {},
      };
    }),
  );
  router.post(
    '/api/assets',
    safe(async (event) => {
      if (!event.context.user) {
        setResponseStatus(event, 401);
        return { error: 'auth_required' };
      }
      const body = await readBody(event);
      const parsed = RegisterBodySchema.safeParse(body);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);
      const asset = await createAsset(adapter, {
        key: parsed.data.key,
        bucket: parsed.data.bucket,
        url: parsed.data.url,
        contentType: parsed.data.contentType ?? null,
        size: parsed.data.size ?? null,
        originalName: parsed.data.originalName ?? null,
      });
      setResponseStatus(event, 201);
      return asset;
    }),
  );
  router.delete(
    '/api/assets/:id',
    defineEventHandler(async (event) => {
      const user = event.context.user;
      if (!user) {
        setResponseStatus(event, 401);
        return { error: 'auth_required' };
      }
      if (!user.isSuper) {
        setResponseStatus(event, 403);
        return { error: 'forbidden' };
      }
      const id = getRouterParam(event, 'id') as string;
      const ok = await deleteAsset(adapter, id);
      if (!ok) {
        setResponseStatus(event, 404);
        return { error: 'not_found' };
      }
      setResponseStatus(event, 204);
      return null;
    }),
  );

  return router;
}

export type { S3Config };
