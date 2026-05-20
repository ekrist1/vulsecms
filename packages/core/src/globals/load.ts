import type { DatabaseAdapter } from '@vulse/db';
import { type CompiledGlobalSet, compileGlobalSet } from './compile.js';
import { GlobalSetDefinitionSchema } from './definition.js';

interface GlobalSetRow {
  definition: string;
}

export interface LoadGlobalSetsOptions {
  adapter: DatabaseAdapter;
}

export async function loadGlobalSets({
  adapter,
}: LoadGlobalSetsOptions): Promise<Map<string, CompiledGlobalSet>> {
  const rows = await adapter.query<GlobalSetRow>(
    'SELECT definition FROM global_sets ORDER BY created_at ASC',
  );
  const out = new Map<string, CompiledGlobalSet>();
  for (const row of rows) {
    const parsed = GlobalSetDefinitionSchema.parse(JSON.parse(row.definition));
    out.set(parsed.handle, compileGlobalSet(parsed));
  }
  return out;
}
