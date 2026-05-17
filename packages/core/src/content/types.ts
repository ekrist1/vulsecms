export interface Entry {
  id: string;
  collection: string;
  parentId: string | null;
  sortOrder: number;
  status: string;
  protected: boolean;
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ListEntriesOptions {
  limit?: number;
  offset?: number;
  q?: string;
  field?: string;
  includeProtected?: boolean;
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
  create(handle: string, input: unknown, ctx?: MutationContext): Promise<Entry>;
  update(handle: string, id: string, input: unknown, ctx?: MutationContext): Promise<Entry>;
  delete(handle: string, id: string): Promise<void>;
}
