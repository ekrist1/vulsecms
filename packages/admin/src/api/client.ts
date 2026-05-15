export interface FieldUi {
  kind: 'text' | 'textarea' | 'blocks' | 'date' | 'boolean' | 'select' | 'relationship';
  options?: readonly string[];
  to?: string;
}

export interface FieldDefinition {
  name: string;
  label?: string;
  ui: FieldUi;
  optional: boolean;
  default?: unknown;
  validation?: { min?: number; max?: number };
}

// Backwards-compat alias for the existing FieldRenderer code.
export type FieldMeta = FieldDefinition;

export interface BlueprintMeta {
  handle: string;
  label: string;
  singleton: boolean;
  fields: FieldDefinition[];
}

// Server PATCH body adds previousName per field.
export type FieldDefinitionWithRename = FieldDefinition & { previousName?: string };
export interface BlueprintDefinitionWithRenames extends Omit<BlueprintMeta, 'fields'> {
  fields: FieldDefinitionWithRename[];
}

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

export interface ApiError {
  error: string;
  issues?: Array<{ path: (string | number)[]; message: string }>;
  message?: string;
}

class ApiClient {
  private base = '';

  async meta(): Promise<BlueprintMeta[]> {
    return this.request<BlueprintMeta[]>('GET', '/api/_meta/collections');
  }
  list(handle: string): Promise<Entry[]> {
    return this.request<Entry[]>('GET', `/api/collections/${handle}`);
  }
  get(handle: string, id: string): Promise<Entry> {
    return this.request<Entry>('GET', `/api/collections/${handle}/${id}`);
  }
  create(handle: string, input: Record<string, unknown>): Promise<Entry> {
    return this.request<Entry>('POST', `/api/collections/${handle}`, input);
  }
  update(handle: string, id: string, input: Record<string, unknown>): Promise<Entry> {
    return this.request<Entry>('PATCH', `/api/collections/${handle}/${id}`, input);
  }
  delete(handle: string, id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/collections/${handle}/${id}`);
  }

  listBlueprints(): Promise<BlueprintMeta[]> {
    return this.request<BlueprintMeta[]>('GET', '/api/blueprints');
  }
  getBlueprint(handle: string): Promise<BlueprintMeta> {
    return this.request<BlueprintMeta>('GET', `/api/blueprints/${handle}`);
  }
  createBlueprint(def: BlueprintMeta): Promise<BlueprintMeta> {
    return this.request<BlueprintMeta>('POST', '/api/blueprints', def);
  }
  updateBlueprint(handle: string, def: BlueprintDefinitionWithRenames): Promise<BlueprintMeta> {
    return this.request<BlueprintMeta>('PATCH', `/api/blueprints/${handle}`, def);
  }
  deleteBlueprint(handle: string): Promise<void> {
    return this.request<void>('DELETE', `/api/blueprints/${handle}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const res = await fetch(this.base + path, init);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok)
      throw Object.assign(new Error('api error'), {
        response: data as ApiError,
        status: res.status,
      });
    return data as T;
  }
}

export const api = new ApiClient();
