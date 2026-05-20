import { buildImageUrl } from '../url.js';
import type { ImageProvider } from './types.js';

export interface LocalProviderOptions {
  secret: string;
}

export function createLocalProvider(opts: LocalProviderOptions): ImageProvider {
  return {
    buildUrl: ({ assetId, mods, originalExt }) =>
      buildImageUrl({
        assetId,
        mods,
        secret: opts.secret,
        ...(originalExt ? { originalExt } : {}),
      }),
  };
}
