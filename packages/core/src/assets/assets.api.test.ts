import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth, seedSuperUser } from '@vulse/auth';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { describe, expect, it } from 'vitest';
import { loadBlueprints } from '../blueprints/load.js';
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
import { createContentService } from '../content/service.js';
import { createApi } from '../http/api.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'blueprints', '__fixtures__');

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
  await seedSuperUser({
    adapter: db,
    bootstrapEmail: 'super@x.com',
    bootstrapPassword: 'hunter2hunter2',
    isProd: false,
  });
  const blueprints = await loadBlueprints({ adapter: db });
  const content = createContentService(db, blueprints);
  const authInstance = createAuth({
    client: db.client,
    env: { authSecret: 'x', baseUrl: 'http://x', allowPublicSignup: true, smtpUrl: undefined },
  });
  const app = createApi({ blueprints, content, adapter: db, authInstance });

  const signin = await app.request('http://x/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'super@x.com', password: 'hunter2hunter2' }),
  });
  const cookie = signin.headers.get('set-cookie') ?? '';
  return { db, app, authInstance, cookie };
}

const validConfig = {
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret-secret-secret',
  region: 'us-east-1',
  bucket: 'my-bucket',
};

describe('assets API', () => {
  it('GET /api/settings/s3 returns unconfigured by default', async () => {
    const { app, authInstance, cookie } = await setup();
    const res = await app.request('http://x/api/settings/s3', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ configured: false, bucket: null });
    authInstance.close();
  });

  it('PUT /api/settings/s3 stores config and GET returns masked key', async () => {
    const { app, authInstance, cookie } = await setup();
    const put = await app.request('http://x/api/settings/s3', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(validConfig),
    });
    expect(put.status).toBe(200);
    const body = await put.json();
    expect(body.configured).toBe(true);
    expect(body.bucket).toBe('my-bucket');
    expect(body.accessKeyId).not.toBe(validConfig.accessKeyId);
    expect(body.accessKeyId).toMatch(/^AKIA/);
    expect(body.accessKeyId).toContain('*');
    authInstance.close();
  });

  it('POST /api/assets/sign returns 412 when S3 is not configured', async () => {
    const { app, authInstance, cookie } = await setup();
    const res = await app.request('http://x/api/assets/sign', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'a.png', contentType: 'image/png' }),
    });
    expect(res.status).toBe(412);
    authInstance.close();
  });

  it('POST /api/assets/sign returns a presigned URL when S3 is configured', async () => {
    const { app, authInstance, cookie } = await setup();
    await app.request('http://x/api/settings/s3', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(validConfig),
    });
    const res = await app.request('http://x/api/assets/sign', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ filename: 'photo.png', contentType: 'image/png' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bucket).toBe('my-bucket');
    expect(body.key).toMatch(/photo\.png$/);
    expect(body.uploadUrl).toContain('X-Amz-Signature=');
    expect(body.uploadUrl).toContain('my-bucket.s3.us-east-1.amazonaws.com');
    expect(body.requiredHeaders).toEqual({ 'content-type': 'image/png' });
    authInstance.close();
  });

  it('POST + GET /api/assets registers and lists an asset', async () => {
    const { app, authInstance, cookie } = await setup();
    const create = await app.request('http://x/api/assets', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        key: '2024-01-01/abc-photo.png',
        bucket: 'my-bucket',
        url: 'https://my-bucket.s3.us-east-1.amazonaws.com/2024-01-01/abc-photo.png',
        contentType: 'image/png',
        size: 1024,
        originalName: 'photo.png',
      }),
    });
    expect(create.status).toBe(201);
    const asset = await create.json();
    expect(asset.id).toBeTruthy();
    expect(asset.originalName).toBe('photo.png');

    const list = await app.request('http://x/api/assets', { headers: { cookie } });
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe(asset.id);
    authInstance.close();
  });

  it('rejects /api/assets when not signed in', async () => {
    const { app, authInstance } = await setup();
    const res = await app.request('http://x/api/assets');
    expect(res.status).toBe(401);
    authInstance.close();
  });
});
