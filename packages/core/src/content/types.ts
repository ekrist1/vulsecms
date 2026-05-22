export interface Entry {
  id: string;
  collection: string;
  parentId: string | null;
  sortOrder: number;
  status: string;
  protected: boolean;
  content: Record<string, unknown>;
  /**
   * SHA-256 hex digest of the canonical stored `content` JSON (16-char
   * prefix). Stable for unchanged content; used by content loaders
   * (e.g. `@vulse/astro`) as the digest for incremental sync.
   */
  contentHash: string;
  draftContent: Record<string, unknown> | null;
  hasUnpublishedChanges: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FilterValue = string | number | boolean;

export interface FieldFilter {
  eq?: FilterValue;
  neq?: FilterValue;
  in?: FilterValue[];
  gt?: FilterValue;
  gte?: FilterValue;
  lt?: FilterValue;
  lte?: FilterValue;
}

export interface SortSpec {
  field: string;
  direction: 'asc' | 'desc';
}

export interface MutationOptions {
  /** Publish on save. Ignored on drafts-disabled collections. */
  publish?: boolean;
}

export interface ListEntriesOptions {
  limit?: number;
  offset?: number;
  q?: string;
  field?: string;
  includeProtected?: boolean;
  /** Include draft-status rows in the result. Default false. */
  includeDrafts?: boolean;
  /**
   * ISO-8601 timestamp. When set, returns only entries with
   * `updated_at > updatedSince`. Useful for incremental content loaders.
   */
  updatedSince?: string;
  /**
   * Filter to a specific parent. Pass `null` for root-level entries (no parent),
   * a string id for that parent's direct children. Omit to disable the filter
   * (list everything in the collection regardless of parent).
   */
  parentId?: string | null;
  filter?: Record<string, FieldFilter>;
  sort?: SortSpec[];
}

export interface MoveEntryInput {
  parentId: string | null;
  sortOrder?: number;
}

export interface EntryNode extends Entry {
  children: EntryNode[];
}

export interface ListEntriesResult {
  items: Entry[];
  total: number;
  limit: number;
  offset: number;
}

export interface MutationContext {
  actor?: { userId: string } | null;
}

export interface ContentService {
  list(handle: string, opts?: ListEntriesOptions): Promise<ListEntriesResult>;
  get(handle: string, id: string): Promise<Entry | null>;
  create(
    handle: string,
    input: unknown,
    ctx?: MutationContext,
    opts?: MutationOptions,
  ): Promise<Entry>;
  update(
    handle: string,
    id: string,
    input: unknown,
    ctx?: MutationContext,
    opts?: MutationOptions,
  ): Promise<Entry>;
  delete(handle: string, id: string): Promise<void>;
  /**
   * Move an entry within a tree-enabled collection. Updates `parent_id` and
   * `sort_order`. Throws `ValidationError` for non-tree collections, missing
   * parents, cycles, or `maxDepth` violations.
   */
  move(handle: string, id: string, input: MoveEntryInput): Promise<Entry>;
  /**
   * Return the full tree of entries for a collection (roots → children → …),
   * ordered by sort_order at each level. Tree-enabled collections only.
   */
  tree(handle: string, opts?: { includeProtected?: boolean }): Promise<EntryNode[]>;
  publish(handle: string, id: string, ctx?: MutationContext): Promise<Entry>;
  unpublish(handle: string, id: string, ctx?: MutationContext): Promise<Entry>;
  discardDraft(handle: string, id: string, ctx?: MutationContext): Promise<Entry>;
}
