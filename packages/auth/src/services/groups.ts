import type { DatabaseAdapter } from '@vulse/db';
import { ulid } from 'ulid';

export interface PermissionRowInput {
  collectionHandle: string;
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canPublish: boolean;
}

export interface GroupDTO {
  id: string;
  handle: string;
  label: string;
  createdAt: string;
  permissions: PermissionRowInput[];
}

async function loadPerms(adapter: DatabaseAdapter, groupId: string): Promise<PermissionRowInput[]> {
  const rows = await adapter.query<{
    collection_handle: string;
    can_read: number; can_create: number; can_update: number; can_delete: number; can_publish: number;
  }>(
    `SELECT collection_handle, can_read, can_create, can_update, can_delete, can_publish
     FROM group_permissions WHERE group_id = ?
     ORDER BY collection_handle`,
    [groupId],
  );
  return rows.map((r) => ({
    collectionHandle: r.collection_handle,
    canRead: r.can_read === 1,
    canCreate: r.can_create === 1,
    canUpdate: r.can_update === 1,
    canDelete: r.can_delete === 1,
    canPublish: r.can_publish === 1,
  }));
}

export async function createGroup(
  adapter: DatabaseAdapter,
  input: { handle: string; label: string },
): Promise<GroupDTO> {
  const id = ulid();
  await adapter.exec(
    `INSERT INTO groups (id, handle, label) VALUES (?, ?, ?)`,
    [id, input.handle, input.label],
  );
  const row = await adapter.queryOne<{ id: string; handle: string; label: string; created_at: string }>(
    `SELECT id, handle, label, created_at FROM groups WHERE id = ?`,
    [id],
  );
  return { id: row!.id, handle: row!.handle, label: row!.label, createdAt: row!.created_at, permissions: [] };
}

export async function listGroups(adapter: DatabaseAdapter): Promise<GroupDTO[]> {
  const rows = await adapter.query<{ id: string; handle: string; label: string; created_at: string }>(
    `SELECT id, handle, label, created_at FROM groups ORDER BY created_at ASC`,
  );
  const out: GroupDTO[] = [];
  for (const r of rows) {
    out.push({
      id: r.id, handle: r.handle, label: r.label, createdAt: r.created_at,
      permissions: await loadPerms(adapter, r.id),
    });
  }
  return out;
}

export async function getGroup(adapter: DatabaseAdapter, handle: string): Promise<GroupDTO | null> {
  const row = await adapter.queryOne<{ id: string; handle: string; label: string; created_at: string }>(
    `SELECT id, handle, label, created_at FROM groups WHERE handle = ?`,
    [handle],
  );
  if (!row) return null;
  return { id: row.id, handle: row.handle, label: row.label, createdAt: row.created_at, permissions: await loadPerms(adapter, row.id) };
}

export async function updateGroup(
  adapter: DatabaseAdapter,
  id: string,
  input: { label?: string },
): Promise<void> {
  if (input.label !== undefined) {
    await adapter.exec(`UPDATE groups SET label = ? WHERE id = ?`, [input.label, id]);
  }
}

export async function setPermissions(
  adapter: DatabaseAdapter,
  groupId: string,
  rows: PermissionRowInput[],
): Promise<void> {
  await adapter.exec('BEGIN');
  try {
    await adapter.exec(`DELETE FROM group_permissions WHERE group_id = ?`, [groupId]);
    for (const r of rows) {
      await adapter.exec(
        `INSERT INTO group_permissions (group_id, collection_handle, can_read, can_create, can_update, can_delete, can_publish)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [groupId, r.collectionHandle, r.canRead ? 1 : 0, r.canCreate ? 1 : 0, r.canUpdate ? 1 : 0, r.canDelete ? 1 : 0, r.canPublish ? 1 : 0],
      );
    }
    await adapter.exec('COMMIT');
  } catch (err) {
    await adapter.exec('ROLLBACK');
    throw err;
  }
}

export async function deleteGroup(adapter: DatabaseAdapter, id: string): Promise<void> {
  await adapter.exec(`DELETE FROM groups WHERE id = ?`, [id]);
}
