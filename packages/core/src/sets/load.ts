import type { DatabaseAdapter } from '@vulse/db';
import { compileSet, type CompiledSet } from './compile.js';
import { SetDefinitionSchema } from './definition.js';

export async function loadSets(opts: { adapter: DatabaseAdapter }): Promise<
  Map<string, CompiledSet>
> {
  const rows = await opts.adapter.query<{ handle: string; definition: string }>(
    `SELECT handle, definition FROM sets ORDER BY created_at ASC`,
  );
  const map = new Map<string, CompiledSet>();
  for (const r of rows) {
    const def = SetDefinitionSchema.parse(JSON.parse(r.definition));
    map.set(r.handle, compileSet(def));
  }
  return map;
}

export async function reloadSet(
  handle: string,
  opts: { adapter: DatabaseAdapter },
): Promise<CompiledSet | null> {
  const row = await opts.adapter.queryOne<{ definition: string }>(
    `SELECT definition FROM sets WHERE handle = ?`,
    [handle],
  );
  if (!row) return null;
  return compileSet(SetDefinitionSchema.parse(JSON.parse(row.definition)));
}
