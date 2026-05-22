/**
 * Public types for `@vulse/astro`. The Astro types below mirror the
 * subset of Astro's Content Layer Loader interface we depend on. We
 * intentionally redeclare them here so that `@vulse/astro` can be
 * tree-shaken into an Astro project without dragging Astro into the
 * Vulse monorepo as a runtime dependency. They are structurally
 * compatible with Astro's own types.
 */

export interface VulseLoaderOptions {
  /** Base URL of the Vulse server, e.g. `http://localhost:3000`. */
  url: string;
  /** Vulse collection handle to sync into this Astro collection. */
  collection: string;
  /**
   * Optional. When set, the loader fetches one specific entry's draft
   * content (in addition to the normal published list) using the preview
   * token. Use this in a preview deployment of your Astro site.
   */
  preview?: {
    /** Preview token from `POST /api/collections/:handle/:id/preview-token`. */
    token: string;
    /** Entry ID the token was issued for. */
    entryId: string;
  };
  /** How many entries to request per page. Defaults to 200, max 500. */
  pageSize?: number;
  /**
   * Override the global `fetch`. Useful for tests; not normally set in
   * production code.
   */
  fetch?: typeof fetch;
}

/** Shape of an entry returned by the Vulse public collections API. */
export interface VulseEntry {
  id: string;
  collection: string;
  parentId: string | null;
  sortOrder: number;
  status: string;
  protected: boolean;
  content: Record<string, unknown>;
  contentHash: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VulseListResponse {
  items: VulseEntry[];
  total: number;
  limit: number;
  offset: number;
}

// ---- Minimal Astro Content Layer types (structurally compatible) ----

export interface AstroLoader {
  name: string;
  load: (context: AstroLoaderContext) => Promise<void>;
  schema?: () => Promise<unknown> | unknown;
}

export interface AstroLoaderContext {
  store: AstroDataStore;
  meta: AstroMetaStore;
  logger: AstroLogger;
  parseData: <T extends Record<string, unknown>>(props: {
    id: string;
    data: T;
  }) => Promise<T>;
}

export interface AstroDataStoreEntry {
  id: string;
  data: Record<string, unknown>;
  digest?: string;
  rendered?: { html: string };
}

export interface AstroDataStore {
  set: (entry: AstroDataStoreEntry) => boolean;
  has: (id: string) => boolean;
  delete: (id: string) => boolean;
  clear: () => void;
}

export interface AstroMetaStore {
  get: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
}

export interface AstroLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}
