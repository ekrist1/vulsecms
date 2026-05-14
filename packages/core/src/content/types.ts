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

export interface ContentService {
  list(handle: string, opts?: { limit?: number; offset?: number }): Promise<Entry[]>;
  get(handle: string, id: string): Promise<Entry | null>;
  create(handle: string, input: unknown): Promise<Entry>;
  update(handle: string, id: string, input: unknown): Promise<Entry>;
  delete(handle: string, id: string): Promise<void>;
}
