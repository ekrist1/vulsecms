import type { ImageModifiers } from '../modifiers.js';

export interface ImageProvider {
  /** Build a URL the browser can request. */
  buildUrl(input: {
    assetId: string;
    mods: ImageModifiers;
    originalExt?: string;
  }): string;
}
