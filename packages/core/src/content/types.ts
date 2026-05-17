export interface Entry {
  id: string;
  collection: string;
  parentId: string | null;
  sortOrder: number;
  status: string;
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ListEntriesOptions {
  limit?: number;
  offset?: number;
  q?: string;
  field?: string;
}

export interface ListEntriesResult {
  items: Entry[];
  total: number;
  limit: number;
  offset: number;
}

export interface ContentService {
  list(handle: string, opts?: ListEntriesOptions): Promise<ListEntriesResult>;
  get(handle: string, id: string): Promise<Entry | null>;
  create(handle: string, input: unknown): Promise<Entry>;
  update(handle: string, id: string, input: unknown): Promise<Entry>;
  delete(handle: string, id: string): Promise<void>;
}
