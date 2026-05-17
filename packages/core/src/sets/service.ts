import type { DatabaseAdapter } from '@vulse/db';
import { ValidationError } from '../errors.js';
import { type SetDefinition, SetDefinitionSchema } from './definition.js';

export interface SetDTO extends SetDefinition {
  createdAt: string;
  updatedAt: string;
}

function parseRow(row: {
  handle: string;
  definition: string;
  created_at: string;
  updated_at: string;
}): SetDTO {
  const def = SetDefinitionSchema.parse(JSON.parse(row.definition));
  return { ...def, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function createSet(
  adapter: DatabaseAdapter,
  input: SetDefinition,
): Promise<SetDTO> {
  const parsed = SetDefinitionSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues);
  const def = parsed.data;
  await adapter.exec(
    `INSERT INTO sets (handle, label, definition, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    [def.handle, def.label, JSON.stringify(def)],
  );
  const created = await getSet(adapter, def.handle);
  if (!created) throw new Error(`set not found after create: ${def.handle}`);
  return created;
}

export async function listSets(adapter: DatabaseAdapter): Promise<SetDTO[]> {
  const rows = await adapter.query<{
    handle: string;
    definition: string;
    created_at: string;
    updated_at: string;
  }>(`SELECT handle, definition, created_at, updated_at FROM sets ORDER BY created_at ASC`);
  return rows.map(parseRow);
}

export async function getSet(adapter: DatabaseAdapter, handle: string): Promise<SetDTO | null> {
  const row = await adapter.queryOne<{
    handle: string;
    definition: string;
    created_at: string;
    updated_at: string;
  }>(`SELECT handle, definition, created_at, updated_at FROM sets WHERE handle = ?`, [handle]);
  return row ? parseRow(row) : null;
}

export async function updateSet(
  adapter: DatabaseAdapter,
  handle: string,
  input: SetDefinition,
): Promise<SetDTO> {
  if (input.handle !== handle) {
    throw new Error(`set handle is immutable (got '${input.handle}', expected '${handle}')`);
  }
  const parsed = SetDefinitionSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues);
  const def = parsed.data;
  await adapter.exec(
    `UPDATE sets SET label = ?, definition = ?, updated_at = datetime('now') WHERE handle = ?`,
    [def.label, JSON.stringify(def), handle],
  );
  const out = await getSet(adapter, handle);
  if (!out) throw new Error(`set not found: ${handle}`);
  return out;
}

export async function deleteSet(adapter: DatabaseAdapter, handle: string): Promise<void> {
  await adapter.exec(`DELETE FROM sets WHERE handle = ?`, [handle]);
}
