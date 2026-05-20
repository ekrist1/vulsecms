import type { DatabaseAdapter } from '@vulse/db';
import { hashPassword } from 'better-auth/crypto';
import { ulid } from 'ulid';
import type { Role } from '../types.js';

export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  isSuper: boolean;
  createdAt: string;
  updatedAt: string;
  groupIds: string[];
}

export interface CreateUserInput {
  email: string;
  password: string;
  name: string | null;
  role: Role;
  isSuper: boolean;
  groupIds?: string[];
}

export interface UpdateUserInput {
  name?: string | null;
  role?: Role;
  isSuper?: boolean;
  groupIds?: string[];
}

async function loadUser(adapter: DatabaseAdapter, id: string): Promise<UserDTO | null> {
  const row = await adapter.queryOne<{
    id: string;
    email: string;
    name: string | null;
    role: Role;
    is_super: number;
    created_at: string;
    updated_at: string;
  }>(`SELECT id, email, name, role, is_super, created_at, updated_at FROM users WHERE id = ?`, [
    id,
  ]);
  if (!row) return null;
  const gs = await adapter.query<{ group_id: string }>(
    `SELECT group_id FROM user_groups WHERE user_id = ?`,
    [id],
  );
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isSuper: row.is_super === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    groupIds: gs.map((g) => g.group_id),
  };
}

export async function createUser(
  adapter: DatabaseAdapter,
  input: CreateUserInput,
): Promise<UserDTO> {
  const userId = ulid();
  const accountId = ulid();
  const hashed = await hashPassword(input.password);

  await adapter.exec('BEGIN');
  try {
    await adapter.exec(
      `INSERT INTO users (id, email, name, role, is_super, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [userId, input.email, input.name, input.role, input.isSuper ? 1 : 0],
    );
    await adapter.exec(
      `INSERT INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
       VALUES (?, ?, ?, 'credential', ?, datetime('now'), datetime('now'))`,
      [accountId, userId, input.email, hashed],
    );
    if (input.groupIds?.length) {
      for (const gid of input.groupIds) {
        await adapter.exec(`INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)`, [
          userId,
          gid,
        ]);
      }
    }
    await adapter.exec('COMMIT');
  } catch (err) {
    await adapter.exec('ROLLBACK');
    throw err;
  }
  return (await loadUser(adapter, userId))!;
}

export async function getUser(adapter: DatabaseAdapter, id: string): Promise<UserDTO | null> {
  return loadUser(adapter, id);
}

export interface ListUsersOptions {
  limit: number;
  offset: number;
  role?: Role;
}

export async function listUsers(adapter: DatabaseAdapter, opts: ListUsersOptions) {
  const where = opts.role ? `WHERE role = ?` : '';
  const whereParams = opts.role ? [opts.role] : [];
  const total =
    (await adapter.queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM users ${where}`, whereParams))
      ?.c ?? 0;
  const rows = await adapter.query<{ id: string }>(
    `SELECT id FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...whereParams, opts.limit, opts.offset],
  );
  const items: UserDTO[] = [];
  for (const r of rows) items.push((await loadUser(adapter, r.id))!);
  return { items, total, limit: opts.limit, offset: opts.offset };
}

export async function updateUser(
  adapter: DatabaseAdapter,
  id: string,
  input: UpdateUserInput,
): Promise<UserDTO> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    params.push(input.name);
  }
  if (input.role !== undefined) {
    sets.push('role = ?');
    params.push(input.role);
  }
  if (input.isSuper !== undefined) {
    sets.push('is_super = ?');
    params.push(input.isSuper ? 1 : 0);
  }
  sets.push(`updated_at = datetime('now')`);
  if (sets.length > 1) {
    await adapter.exec(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }
  if (input.groupIds) {
    await adapter.exec(`DELETE FROM user_groups WHERE user_id = ?`, [id]);
    for (const gid of input.groupIds) {
      await adapter.exec(`INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)`, [id, gid]);
    }
  }
  const out = await loadUser(adapter, id);
  if (!out) throw new Error(`user not found: ${id}`);
  return out;
}

export async function deleteUser(adapter: DatabaseAdapter, id: string): Promise<void> {
  await adapter.exec(`DELETE FROM users WHERE id = ?`, [id]);
}
