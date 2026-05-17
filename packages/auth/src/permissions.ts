import type { DatabaseAdapter } from '@vulse/db';
import type { Action, AuthUser, EffectivePerms } from './types.js';

interface PermRow {
  collection_handle: string;
  can_read: number;
  can_create: number;
  can_update: number;
  can_delete: number;
}

export async function effectivePerms(
  user: AuthUser,
  adapter: DatabaseAdapter,
): Promise<EffectivePerms> {
  if (user.isSuper) {
    return new Map([['*', new Set<Action>(['read', 'create', 'update', 'delete'])]]);
  }
  if (user.role === 'external_user') return new Map();

  const rows = await adapter.query<PermRow>(
    `SELECT gp.collection_handle, gp.can_read, gp.can_create, gp.can_update, gp.can_delete
     FROM user_groups ug
     JOIN group_permissions gp ON gp.group_id = ug.group_id
     WHERE ug.user_id = ?`,
    [user.id],
  );
  const map: EffectivePerms = new Map();
  for (const r of rows) {
    const set = map.get(r.collection_handle) ?? new Set<Action>();
    if (r.can_read) set.add('read');
    if (r.can_create) set.add('create');
    if (r.can_update) set.add('update');
    if (r.can_delete) set.add('delete');
    map.set(r.collection_handle, set);
  }
  return map;
}

export function permsToWire(perms: EffectivePerms): Record<string, Action[]> {
  const out: Record<string, Action[]> = {};
  for (const [k, v] of perms) out[k] = [...v];
  return out;
}
