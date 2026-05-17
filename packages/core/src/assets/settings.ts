import type { DatabaseAdapter } from '@vulse/db';
import { type S3Config, type S3ConfigPublic, S3ConfigSchema } from './types.js';

const SETTINGS_KEY = 's3.config';

export async function getS3Config(adapter: DatabaseAdapter): Promise<S3Config | null> {
  const row = await adapter.queryOne<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [SETTINGS_KEY],
  );
  if (!row) return null;
  try {
    const parsed = S3ConfigSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function setS3Config(adapter: DatabaseAdapter, config: S3Config): Promise<void> {
  const value = JSON.stringify(config);
  await adapter.exec(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [SETTINGS_KEY, value],
  );
}

export async function deleteS3Config(adapter: DatabaseAdapter): Promise<void> {
  await adapter.exec('DELETE FROM settings WHERE key = ?', [SETTINGS_KEY]);
}

export function toPublic(config: S3Config | null): S3ConfigPublic {
  if (!config) {
    return {
      configured: false,
      accessKeyId: null,
      region: null,
      bucket: null,
      endpoint: null,
      publicBaseUrl: null,
      forcePathStyle: false,
    };
  }
  return {
    configured: true,
    accessKeyId: maskKey(config.accessKeyId),
    region: config.region,
    bucket: config.bucket,
    endpoint: config.endpoint ?? null,
    publicBaseUrl: config.publicBaseUrl ?? null,
    forcePathStyle: config.forcePathStyle ?? false,
  };
}

function maskKey(key: string): string {
  if (key.length <= 4) return '****';
  return `${key.slice(0, 4)}${'*'.repeat(Math.max(4, key.length - 8))}${key.slice(-4)}`;
}
