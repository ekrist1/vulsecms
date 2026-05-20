import type { DatabaseAdapter } from '@vulse/db';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { type CompiledGlobalSet, compileGlobalSet } from './compile.js';
import {
  type GlobalSetDefinition,
  GlobalSetDefinitionSchema,
  hashGlobalSetDefinition,
} from './definition.js';

interface GlobalSetRow {
  handle: string;
  label: string;
  definition: string;
  blueprint_hash: string;
  created_at: string;
  updated_at: string;
}

interface GlobalValueRow {
  handle: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface GlobalSetDTO {
  handle: string;
  label: string;
  fields: GlobalSetDefinition['fields'];
  createdAt: string;
  updatedAt: string;
}

export interface GlobalValueDTO {
  handle: string;
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type PublicGlobals = Record<string, Record<string, unknown>>;

export interface GlobalService {
  listSets(): Promise<GlobalSetDTO[]>;
  getSet(handle: string): Promise<GlobalSetDTO | null>;
  createSet(input: unknown): Promise<GlobalSetDTO>;
  updateSet(handle: string, input: unknown): Promise<GlobalSetDTO>;
  deleteSet(handle: string): Promise<void>;
  getValue(handle: string): Promise<GlobalValueDTO | null>;
  updateValue(handle: string, input: unknown): Promise<GlobalValueDTO>;
  publicValues(): Promise<PublicGlobals>;
}

function setToDTO(row: GlobalSetRow): GlobalSetDTO {
  const definition = GlobalSetDefinitionSchema.parse(JSON.parse(row.definition));
  return {
    handle: row.handle,
    label: row.label,
    fields: definition.fields,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function valueToDTO(row: GlobalValueRow): GlobalValueDTO {
  return {
    handle: row.handle,
    content: JSON.parse(row.content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createGlobalService(
  adapter: DatabaseAdapter,
  globalSets: Map<string, CompiledGlobalSet>,
): GlobalService {
  function compiled(handle: string): CompiledGlobalSet {
    const set = globalSets.get(handle);
    if (!set) throw new NotFoundError(`unknown global set: ${handle}`);
    return set;
  }

  function validate(set: CompiledGlobalSet, input: unknown): Record<string, unknown> {
    const result = set.schema.safeParse(input);
    if (!result.success) throw new ValidationError(result.error.issues);
    return result.data as Record<string, unknown>;
  }

  async function getSetRow(handle: string): Promise<GlobalSetRow | null> {
    return await adapter.queryOne<GlobalSetRow>('SELECT * FROM global_sets WHERE handle = ?', [
      handle,
    ]);
  }

  async function getValueRow(handle: string): Promise<GlobalValueRow | null> {
    return await adapter.queryOne<GlobalValueRow>('SELECT * FROM global_values WHERE handle = ?', [
      handle,
    ]);
  }

  return {
    async listSets() {
      const rows = await adapter.query<GlobalSetRow>(
        'SELECT * FROM global_sets ORDER BY created_at ASC',
      );
      return rows.map(setToDTO);
    },

    async getSet(handle) {
      const row = await getSetRow(handle);
      return row ? setToDTO(row) : null;
    },

    async createSet(input) {
      const parsed = GlobalSetDefinitionSchema.safeParse(input);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);
      const existing = await getSetRow(parsed.data.handle);
      if (existing) throw new ConflictError(`global set already exists: ${parsed.data.handle}`);

      const hash = hashGlobalSetDefinition(parsed.data);
      await adapter.exec(
        `INSERT INTO global_sets (handle, label, definition, blueprint_hash)
         VALUES (?, ?, ?, ?)`,
        [parsed.data.handle, parsed.data.label, JSON.stringify(parsed.data), hash],
      );
      await adapter.exec('INSERT INTO global_values (handle, content) VALUES (?, ?)', [
        parsed.data.handle,
        '{}',
      ]);
      globalSets.set(parsed.data.handle, compileGlobalSet(parsed.data));
      const row = await getSetRow(parsed.data.handle);
      return setToDTO(row!);
    },

    async updateSet(handle, input) {
      const parsed = GlobalSetDefinitionSchema.safeParse(input);
      if (!parsed.success) throw new ValidationError(parsed.error.issues);
      const existing = await getSetRow(handle);
      if (!existing) throw new NotFoundError(`global set not found: ${handle}`);
      if (parsed.data.handle !== handle) {
        throw new ValidationError([
          {
            code: 'custom',
            message: 'Global set handles are immutable.',
            path: ['handle'],
          },
        ]);
      }

      const hash = hashGlobalSetDefinition(parsed.data);
      await adapter.exec(
        `UPDATE global_sets
         SET label = ?, definition = ?, blueprint_hash = ?, updated_at = datetime('now')
         WHERE handle = ?`,
        [parsed.data.label, JSON.stringify(parsed.data), hash, handle],
      );
      globalSets.set(handle, compileGlobalSet(parsed.data));
      const row = await getSetRow(handle);
      return setToDTO(row!);
    },

    async deleteSet(handle) {
      const existing = await getSetRow(handle);
      if (!existing) throw new NotFoundError(`global set not found: ${handle}`);
      await adapter.exec('DELETE FROM global_sets WHERE handle = ?', [handle]);
      globalSets.delete(handle);
    },

    async getValue(handle) {
      compiled(handle);
      const row = await getValueRow(handle);
      return row ? valueToDTO(row) : null;
    },

    async updateValue(handle, input) {
      const set = compiled(handle);
      const validated = validate(set, input);
      await adapter.exec(
        `INSERT INTO global_values (handle, content, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(handle) DO UPDATE SET
           content = excluded.content,
           updated_at = datetime('now')`,
        [handle, JSON.stringify(validated)],
      );
      const row = await getValueRow(handle);
      return valueToDTO(row!);
    },

    async publicValues() {
      const rows = await adapter.query<GlobalValueRow>(
        `SELECT gv.*
         FROM global_values gv
         INNER JOIN global_sets gs ON gs.handle = gv.handle
         ORDER BY gs.created_at ASC`,
      );
      const out: PublicGlobals = {};
      for (const row of rows) out[row.handle] = JSON.parse(row.content);
      return out;
    },
  };
}
