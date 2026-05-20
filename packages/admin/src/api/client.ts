export type NonReplicatorFieldUi =
  | { kind: 'text' }
  | { kind: 'textarea' }
  | { kind: 'blocks'; sets?: string[] }
  | { kind: 'date' }
  | { kind: 'boolean' }
  | { kind: 'select'; options: readonly string[] }
  | { kind: 'relationship'; to: string }
  | { kind: 'asset' };

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
  tree: boolean;
  maxDepth?: number;
  drafts?: boolean;
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
  draftContent: Record<string, unknown> | null;
  hasUnpublishedChanges: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
  updatedAt: string;
  protected: boolean;
}

export interface EntryNode extends Entry {
  children: EntryNode[];
}

export interface EntryListQuery {
  limit?: number;
  offset?: number;
  q?: string;
  field?: string;
  /** Filter to a parent: `null` for root entries, an id for direct children. Omit for all. */
  parentId?: string | null;
  includeDrafts?: boolean;
  filter?: Record<string, { eq?: unknown }>;
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
  perms: Record<string, ('read' | 'create' | 'update' | 'delete' | 'publish')[]>;
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
    canPublish: boolean;
  }[];
}

export interface DatabaseSummary {
  driver: 'libsql';
  scheme: 'file' | 'libsql' | 'http' | 'https' | 'ws' | 'wss' | 'memory' | 'unknown';
  host: string | null;
  syncUrlHost: string | null;
  embeddedReplica: boolean;
  remote: boolean;
  encrypted: boolean;
}

export interface RevisionSummary {
  id: string;
  entryId: string;
  revisionNumber: number;
  createdAt: string;
  createdBy: string | null;
}

export interface RevisionDetail extends RevisionSummary {
  content: Record<string, unknown>;
}

export interface RevisionListResponse {
  items: RevisionSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface AssetItem {
  id: string;
  key: string;
  bucket: string;
  url: string;
  contentType: string | null;
  size: number | null;
  originalName: string | null;
  createdAt: string;
}

export interface AssetListResponse {
  items: AssetItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AssetSignResponse {
  key: string;
  bucket: string;
  uploadUrl: string;
  publicUrl: string;
  requiredHeaders: Record<string, string>;
}

export interface S3SettingsPublic {
  configured: boolean;
  accessKeyId: string | null;
  region: string | null;
  bucket: string | null;
  endpoint: string | null;
  publicBaseUrl: string | null;
  forcePathStyle: boolean;
}

export interface S3SettingsInput {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  endpoint?: string;
  publicBaseUrl?: string;
  forcePathStyle?: boolean;
}

export interface SetFieldDef {
  name: string;
  label?: string;
  ui: { kind: string } & Record<string, unknown>;
  optional: boolean;
  default?: unknown;
  validation?: { min?: number; max?: number };
}

export interface SetDTO {
  handle: string;
  label: string;
  fields: SetFieldDef[];
  createdAt: string;
  updatedAt: string;
}

export interface GlobalSetDTO {
  handle: string;
  label: string;
  fields: FieldMeta[];
  createdAt: string;
  updatedAt: string;
}

export interface GlobalValueDTO {
  handle: string;
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
    if ('parentId' in query) {
      params.set('parent_id', query.parentId === null ? 'root' : (query.parentId as string));
    }
    if (query.includeDrafts === true) params.set('includeDrafts', '1');
    if (query.filter) {
      for (const [key, filterObj] of Object.entries(query.filter)) {
        if (filterObj.eq !== undefined) {
          params.set(`filter[${key}][eq]`, String(filterObj.eq));
        }
      }
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.request<Entry[] | EntryListResponse>(
      'GET',
      `/api/collections/${handle}${suffix}`,
    ).then(normalizeEntryList);
  }
  async listAll(handle: string, limit = 500): Promise<Entry[]> {
    const result = await this.list(handle, { limit, offset: 0 });
    return result.items;
  }
  get(handle: string, id: string): Promise<Entry> {
    return this.request<Entry>('GET', `/api/collections/${handle}/${id}`);
  }
  create(
    handle: string,
    input: Record<string, unknown>,
    opts?: { publish?: boolean },
  ): Promise<Entry> {
    const body = opts?.publish !== undefined ? { ...input, publish: opts.publish } : input;
    return this.request<Entry>('POST', `/api/collections/${handle}`, body);
  }
  update(
    handle: string,
    id: string,
    input: Record<string, unknown>,
    opts?: { publish?: boolean },
  ): Promise<Entry> {
    const body = opts?.publish !== undefined ? { ...input, publish: opts.publish } : input;
    return this.request<Entry>('PATCH', `/api/collections/${handle}/${id}`, body);
  }
  delete(handle: string, id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/collections/${handle}/${id}`);
  }
  publish(handle: string, id: string): Promise<Entry> {
    return this.request<Entry>('POST', `/api/collections/${handle}/${id}/publish`, {});
  }
  unpublish(handle: string, id: string): Promise<Entry> {
    return this.request<Entry>('POST', `/api/collections/${handle}/${id}/unpublish`, {});
  }
  discardDraft(handle: string, id: string): Promise<Entry> {
    return this.request<Entry>('DELETE', `/api/collections/${handle}/${id}/draft`);
  }
  previewToken(handle: string, id: string): Promise<{ token: string; expiresAt: string }> {
    return this.request<{ token: string; expiresAt: string }>(
      'POST',
      `/api/collections/${handle}/${id}/preview-token`,
      {},
    );
  }
  getTree(handle: string): Promise<EntryNode[]> {
    return this.request<EntryNode[]>('GET', `/api/collections/${handle}/tree`);
  }
  moveEntry(
    handle: string,
    id: string,
    input: { parentId: string | null; sortOrder?: number },
  ): Promise<Entry> {
    return this.request<Entry>('PATCH', `/api/collections/${handle}/${id}/move`, input);
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
    return this.request<{ items: UserDTO[]; total: number; limit: number; offset: number }>(
      'GET',
      `/api/users?${qs}`,
    );
  }
  async getUser(id: string) {
    return this.request<UserDTO>('GET', `/api/users/${id}`);
  }
  async createUser(body: {
    email: string;
    password: string;
    name?: string | null;
    role: 'editor' | 'external_user';
    isSuper: boolean;
    groupIds?: string[];
  }) {
    return this.request<UserDTO>('POST', '/api/users', body);
  }
  async updateUser(
    id: string,
    body: Partial<{
      name: string | null;
      role: 'editor' | 'external_user';
      isSuper: boolean;
      groupIds: string[];
    }>,
  ) {
    return this.request<UserDTO>('PATCH', `/api/users/${id}`, body);
  }
  async deleteUser(id: string) {
    return this.request<void>('DELETE', `/api/users/${id}`);
  }

  async listGroups() {
    return this.request<GroupDTO[]>('GET', '/api/groups');
  }
  async getGroup(handle: string) {
    return this.request<GroupDTO>('GET', `/api/groups/${handle}`);
  }
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

  async getDatabaseSummary(): Promise<DatabaseSummary> {
    return this.request<DatabaseSummary>('GET', '/api/_system/database');
  }

  // ---- Revisions ----
  async listRevisions(
    handle: string,
    id: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<RevisionListResponse> {
    const qs = new URLSearchParams();
    qs.set('limit', String(opts?.limit ?? 50));
    qs.set('offset', String(opts?.offset ?? 0));
    return this.request<RevisionListResponse>(
      'GET',
      `/api/collections/${handle}/${id}/revisions?${qs}`,
    );
  }
  async getRevision(handle: string, id: string, revisionId: string): Promise<RevisionDetail> {
    return this.request<RevisionDetail>(
      'GET',
      `/api/collections/${handle}/${id}/revisions/${revisionId}`,
    );
  }
  async restoreRevision(handle: string, id: string, revisionId: string): Promise<Entry> {
    return this.request<Entry>(
      'POST',
      `/api/collections/${handle}/${id}/revisions/${revisionId}/restore`,
    );
  }

  // ---- Assets / S3 ----
  async listAssets(opts?: { limit?: number; offset?: number }): Promise<AssetListResponse> {
    const qs = new URLSearchParams();
    qs.set('limit', String(opts?.limit ?? 50));
    qs.set('offset', String(opts?.offset ?? 0));
    return this.request<AssetListResponse>('GET', `/api/assets?${qs}`);
  }
  async getAsset(id: string): Promise<AssetItem> {
    return this.request<AssetItem>('GET', `/api/assets/${id}`);
  }
  async signAssetUpload(body: {
    filename: string;
    contentType?: string;
    prefix?: string;
  }): Promise<AssetSignResponse> {
    return this.request<AssetSignResponse>('POST', '/api/assets/sign', body);
  }
  async registerAsset(body: {
    key: string;
    bucket: string;
    url: string;
    contentType?: string | null;
    size?: number | null;
    originalName?: string | null;
  }): Promise<AssetItem> {
    return this.request<AssetItem>('POST', '/api/assets', body);
  }
  async deleteAsset(id: string): Promise<void> {
    return this.request<void>('DELETE', `/api/assets/${id}`);
  }
  async getAssetThumbUrl(id: string, width = 240): Promise<{ url: string }> {
    return this.request<{ url: string }>(
      'GET',
      `/api/assets/${encodeURIComponent(id)}/thumb-url?w=${width}`,
    );
  }
  async getS3Settings(): Promise<S3SettingsPublic> {
    return this.request<S3SettingsPublic>('GET', '/api/settings/s3');
  }
  async saveS3Settings(body: S3SettingsInput): Promise<S3SettingsPublic> {
    return this.request<S3SettingsPublic>('PUT', '/api/settings/s3', body);
  }
  async clearS3Settings(): Promise<void> {
    return this.request<void>('DELETE', '/api/settings/s3');
  }

  async listSets(): Promise<SetDTO[]> {
    return this.request<SetDTO[]>('GET', '/api/sets');
  }
  async getSet(handle: string): Promise<SetDTO> {
    return this.request<SetDTO>('GET', `/api/sets/${handle}`);
  }
  async createSet(body: { handle: string; label: string; fields: SetFieldDef[] }): Promise<SetDTO> {
    return this.request<SetDTO>('POST', '/api/sets', body);
  }
  async updateSet(
    handle: string,
    body: { handle: string; label: string; fields: SetFieldDef[] },
  ): Promise<SetDTO> {
    return this.request<SetDTO>('PATCH', `/api/sets/${handle}`, body);
  }
  async deleteSet(handle: string): Promise<void> {
    return this.request<void>('DELETE', `/api/sets/${handle}`);
  }

  async listGlobalSets(): Promise<GlobalSetDTO[]> {
    return this.request<GlobalSetDTO[]>('GET', '/api/globals');
  }
  async getGlobalSet(handle: string): Promise<{ set: GlobalSetDTO; value: GlobalValueDTO | null }> {
    return this.request<{ set: GlobalSetDTO; value: GlobalValueDTO | null }>(
      'GET',
      `/api/globals/${handle}`,
    );
  }
  async createGlobalSet(body: {
    handle: string;
    label: string;
    fields: FieldMeta[];
  }): Promise<GlobalSetDTO> {
    return this.request<GlobalSetDTO>('POST', '/api/globals', body);
  }
  async updateGlobalSet(
    handle: string,
    body: { handle: string; label: string; fields: FieldMeta[] },
  ): Promise<GlobalSetDTO> {
    return this.request<GlobalSetDTO>('PATCH', `/api/globals/${handle}`, body);
  }
  async updateGlobalValue(
    handle: string,
    content: Record<string, unknown>,
  ): Promise<GlobalValueDTO> {
    return this.request<GlobalValueDTO>('PUT', `/api/globals/${handle}/value`, content);
  }
  async deleteGlobalSet(handle: string): Promise<void> {
    return this.request<void>('DELETE', `/api/globals/${handle}`);
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
