import type { DatabaseAdapter } from '@vulse/db';
import { ulid } from 'ulid';
import type { AssetDTO, S3Config } from './types.js';

interface AssetRow {
  id: string;
  key: string;
  bucket: string;
  url: string;
  content_type: string | null;
  size: number | null;
  original_name: string | null;
  created_at: string;
}

function rowToDTO(r: AssetRow): AssetDTO {
  return {
    id: r.id,
    key: r.key,
    bucket: r.bucket,
    url: r.url,
    contentType: r.content_type,
    size: r.size,
    originalName: r.original_name,
    createdAt: r.created_at,
  };
}

export async function listAssets(
  adapter: DatabaseAdapter,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ items: AssetDTO[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  const rows = await adapter.query<AssetRow>(
    'SELECT * FROM assets ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset],
  );
  const totalRow = await adapter.queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM assets');
  return {
    items: rows.map(rowToDTO),
    total: Number(totalRow?.c ?? 0),
    limit,
    offset,
  };
}

export async function getAsset(adapter: DatabaseAdapter, id: string): Promise<AssetDTO | null> {
  const row = await adapter.queryOne<AssetRow>('SELECT * FROM assets WHERE id = ?', [id]);
  return row ? rowToDTO(row) : null;
}

export interface CreateAssetInput {
  key: string;
  url: string;
  bucket: string;
  contentType?: string | null;
  size?: number | null;
  originalName?: string | null;
}

export async function createAsset(
  adapter: DatabaseAdapter,
  input: CreateAssetInput,
): Promise<AssetDTO> {
  const id = ulid();
  await adapter.exec(
    `INSERT INTO assets (id, key, bucket, url, content_type, size, original_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.key,
      input.bucket,
      input.url,
      input.contentType ?? null,
      input.size ?? null,
      input.originalName ?? null,
    ],
  );
  const row = await adapter.queryOne<AssetRow>('SELECT * FROM assets WHERE id = ?', [id]);
  if (!row) throw new Error('failed to create asset');
  return rowToDTO(row);
}

export async function deleteAsset(adapter: DatabaseAdapter, id: string): Promise<boolean> {
  const existing = await getAsset(adapter, id);
  if (!existing) return false;
  await adapter.exec('DELETE FROM assets WHERE id = ?', [id]);
  return true;
}

export function buildObjectKey(originalName: string, prefix = ''): string {
  const safe =
    originalName
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'file';
  const stamp = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 10);
  const cleaned = prefix.replace(/^\/+|\/+$/g, '');
  const head = cleaned ? `${cleaned}/` : '';
  return `${head}${stamp}/${rand}-${safe}`;
}

export type { S3Config };
