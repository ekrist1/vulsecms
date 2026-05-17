export type NonReplicatorFieldUi =
  | { kind: 'text' }
  | { kind: 'textarea' }
  | { kind: 'blocks' }
  | { kind: 'date' }
  | { kind: 'boolean' }
  | { kind: 'select'; options: readonly string[] }
  | { kind: 'relationship'; to: string };

export interface NestedFieldDefinition {
  name: string;
  label?: string;
  ui: NonReplicatorFieldUi;
  optional: boolean;
  default?: unknown;
  validation?: { min?: number; max?: number };
}

export interface ReplicatorSetDefinition {
  name: string;
  label?: string;
  fields: NestedFieldDefinition[];
}

export type FieldUi =
  | NonReplicatorFieldUi
  | {
      kind: 'replicator';
      sets: ReplicatorSetDefinition[];
    };

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

export interface EntryListQuery {
  limit?: number;
  offset?: number;
  q?: string;
  field?: string;
}

export interface EntryListResponse {
  items: Entry[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiError {
  error: string;
  issues?: Array<{ path: (string | number)[]; message: string }>;
  message?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: 'editor' | 'external_user';
  isSuper: boolean;
}

export interface MeResponse {
  user: AuthUser | null;
  perms: Record<string, ('read' | 'create' | 'update' | 'delete')[]>;
}

export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  role: 'editor' | 'external_user';
  isSuper: boolean;
  createdAt: string;
  updatedAt: string;
  groupIds: string[];
}

export interface GroupDTO {
  id: string;
  handle: string;
  label: string;
  createdAt: string;
  permissions: {
    collectionHandle: string;
    canRead: boolean;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
  }[];
}

function normalizeEntryList(data: Entry[] | EntryListResponse): EntryListResponse {
  if (Array.isArray(data)) {
    return {
      items: data,
      total: data.length,
      limit: data.length,
      offset: 0,
    };
  }
  return data;
}

class ApiClient {
  private base = '';

  async meta(): Promise<BlueprintMeta[]> {
    return this.request<BlueprintMeta[]>('GET', '/api/_meta/collections');
  }
  list(handle: string, query: EntryListQuery = {}): Promise<EntryListResponse> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));
    if (query.q) params.set('q', query.q);
    if (query.field) params.set('field', query.field);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.request<Entry[] | EntryListResponse>('GET', `/api/collections/${handle}${suffix}`).then(
      normalizeEntryList,
    );
  }
  async listAll(handle: string, limit = 500): Promise<Entry[]> {
    const result = await this.list(handle, { limit, offset: 0 });
    return result.items;
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

  async listUsers(opts?: { role?: string; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (opts?.role) qs.set('role', opts.role);
    qs.set('limit', String(opts?.limit ?? 50));
    qs.set('offset', String(opts?.offset ?? 0));
    return this.request<{ items: UserDTO[]; total: number; limit: number; offset: number }>('GET', `/api/users?${qs}`);
  }
  async getUser(id: string) { return this.request<UserDTO>('GET', `/api/users/${id}`); }
  async createUser(body: { email: string; password: string; name?: string | null; role: 'editor' | 'external_user'; isSuper: boolean; groupIds?: string[] }) {
    return this.request<UserDTO>('POST', '/api/users', body);
  }
  async updateUser(id: string, body: Partial<{ name: string | null; role: 'editor' | 'external_user'; isSuper: boolean; groupIds: string[] }>) {
    return this.request<UserDTO>('PATCH', `/api/users/${id}`, body);
  }
  async deleteUser(id: string) {
    return this.request<void>('DELETE', `/api/users/${id}`);
  }

  async listGroups() { return this.request<GroupDTO[]>('GET', '/api/groups'); }
  async getGroup(handle: string) { return this.request<GroupDTO>('GET', `/api/groups/${handle}`); }
  async createGroup(body: { handle: string; label: string }) {
    return this.request<GroupDTO>('POST', '/api/groups', body);
  }
  async updateGroup(handle: string, body: { label?: string }) {
    return this.request<GroupDTO>('PATCH', `/api/groups/${handle}`, body);
  }
  async setGroupPermissions(handle: string, rows: GroupDTO['permissions']) {
    return this.request<GroupDTO>('PUT', `/api/groups/${handle}/permissions`, { rows });
  }
  async deleteGroup(handle: string) {
    return this.request<void>('DELETE', `/api/groups/${handle}`);
  }

  me(): Promise<MeResponse> {
    return this.request<MeResponse>('GET', '/api/auth/me');
  }
  login(email: string, password: string): Promise<void> {
    return this.request<void>('POST', '/api/auth/sign-in/email', { email, password });
  }
  logout(): Promise<void> {
    return this.request<void>('POST', '/api/auth/sign-out');
  }
  forgotPassword(email: string): Promise<void> {
    return this.request<void>('POST', '/api/auth/forget-password', {
      email,
      redirectTo: `${location.origin}/reset-password`,
    });
  }
  resetPassword(token: string, newPassword: string): Promise<void> {
    return this.request<void>('POST', '/api/auth/reset-password', { token, newPassword });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, credentials: 'include' };
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
