import type { AuthVars } from '@vulse/auth';
import type { DatabaseAdapter } from '@vulse/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../errors.js';
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

function requireSuperGuard(c: { get: (k: 'user') => { isSuper: boolean } | null }) {
  const user = c.get('user');
  if (!user) return { ok: false as const, status: 401 as const, body: { error: 'auth_required' } };
  if (!user.isSuper)
    return { ok: false as const, status: 403 as const, body: { error: 'forbidden' } };
  return { ok: true as const };
}

function requireAuth(c: { get: (k: 'user') => { isSuper: boolean } | null }) {
  const user = c.get('user');
  if (!user) return { ok: false as const, status: 401 as const, body: { error: 'auth_required' } };
  return { ok: true as const };
}

export function assetRoutes(adapter: DatabaseAdapter): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();

  // ---- S3 settings (super only) ----
  app.get('/api/settings/s3', async (c) => {
    const guard = requireSuperGuard(c);
    if (!guard.ok) return c.json(guard.body, guard.status);
    const cfg = await getS3Config(adapter);
    return c.json(toPublic(cfg));
  });

  app.put('/api/settings/s3', async (c) => {
    const guard = requireSuperGuard(c);
    if (!guard.ok) return c.json(guard.body, guard.status);
    const body = await c.req.json();
    const parsed = S3ConfigSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    await setS3Config(adapter, parsed.data);
    return c.json(toPublic(parsed.data));
  });

  app.delete('/api/settings/s3', async (c) => {
    const guard = requireSuperGuard(c);
    if (!guard.ok) return c.json(guard.body, guard.status);
    await deleteS3Config(adapter);
    return c.body(null, 204);
  });

  // ---- Assets ----
  app.get('/api/assets', async (c) => {
    const guard = requireAuth(c);
    if (!guard.ok) return c.json(guard.body, guard.status);
    const limit = Number(c.req.query('limit') ?? '50');
    const offset = Number(c.req.query('offset') ?? '0');
    return c.json(await listAssets(adapter, { limit, offset }));
  });

  app.get('/api/assets/:id', async (c) => {
    const guard = requireAuth(c);
    if (!guard.ok) return c.json(guard.body, guard.status);
    const asset = await getAsset(adapter, c.req.param('id'));
    if (!asset) return c.json({ error: 'not_found' }, 404);
    return c.json(asset);
  });

  app.post('/api/assets/sign', async (c) => {
    const guard = requireAuth(c);
    if (!guard.ok) return c.json(guard.body, guard.status);
    const config = await getS3Config(adapter);
    if (!config) return c.json({ error: 's3_not_configured' }, 412);
    const body = await c.req.json();
    const parsed = SignBodySchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues);
    const key = buildObjectKey(parsed.data.filename, parsed.data.prefix);
    const uploadUrl = presignUrl({
      config,
      method: 'PUT',
      key,
      ...(parsed.data.contentType ? { contentType: parsed.data.contentType } : {}),
    });
    return c.json({
      key,
      bucket: config.bucket,
      uploadUrl,
      publicUrl: publicUrlFor(config, key),
      requiredHeaders: parsed.data.contentType ? { 'content-type': parsed.data.contentType } : {},
    });
  });

  app.post('/api/assets', async (c) => {
    const guard = requireAuth(c);
    if (!guard.ok) return c.json(guard.body, guard.status);
    const body = await c.req.json();
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
    return c.json(asset, 201);
  });

  app.delete('/api/assets/:id', async (c) => {
    const guard = requireAuth(c);
    if (!guard.ok) return c.json(guard.body, guard.status);
    const user = c.get('user');
    if (!user?.isSuper) return c.json({ error: 'forbidden' }, 403);
    const ok = await deleteAsset(adapter, c.req.param('id'));
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });

  return app;
}

export type { S3Config };
