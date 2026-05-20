import type { DatabaseAdapter } from '@vulse/db';
import { getAsset, getS3Config, presignUrl, type AssetDTO } from '@vulse/core';

export interface FetchedSource {
  asset: AssetDTO;
  buffer: Buffer;
  originalExt: string;
}

export async function fetchAssetSource(
  adapter: DatabaseAdapter,
  assetId: string,
): Promise<FetchedSource | null> {
  const asset = await getAsset(adapter, assetId);
  if (!asset) return null;
  const config = await getS3Config(adapter);
  if (!config) throw new Error('s3 not configured');
  const signedGet = presignUrl({ config, method: 'GET', key: asset.key });
  const res = await fetch(signedGet);
  if (!res.ok) throw new Error(`s3 fetch failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const originalExt = extractExt(asset.originalName, asset.key);
  return { asset, buffer, originalExt };
}

function extractExt(originalName: string | null, key: string): string {
  const source = originalName ?? key;
  const dot = source.lastIndexOf('.');
  if (dot < 0) return 'jpg';
  return source.slice(dot + 1).toLowerCase();
}
