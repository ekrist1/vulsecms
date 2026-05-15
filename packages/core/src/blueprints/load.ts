import type { DatabaseAdapter } from '@vulse/db';
import type { Blueprint } from './types.js';
import { BlueprintDefinitionSchema, type BlueprintDefinition } from './definition.js';
import { compileBlueprint } from './compile.js';

export interface LoadOptions {
  adapter: DatabaseAdapter;
}

export async function loadBlueprints(opts: LoadOptions): Promise<Map<string, Blueprint>> {
  const rows = await opts.adapter.query<{ handle: string; definition: string | null }>(
    'SELECT handle, definition FROM collections ORDER BY created_at ASC',
  );
  const map = new Map<string, Blueprint>();
  for (const row of rows) {
    if (!row.definition) {
      throw new Error(`collection '${row.handle}' has no definition; run seedBlueprintsFromCode first`);
    }
    const parsed = JSON.parse(row.definition);
    const def: BlueprintDefinition = BlueprintDefinitionSchema.parse(parsed);
    map.set(def.handle, compileBlueprint(def));
  }
  return map;
}

export async function reloadBlueprint(handle: string, opts: LoadOptions): Promise<Blueprint | null> {
  const row = await opts.adapter.queryOne<{ definition: string | null }>(
    'SELECT definition FROM collections WHERE handle = ?',
    [handle],
  );
  if (!row || !row.definition) return null;
  const def: BlueprintDefinition = BlueprintDefinitionSchema.parse(JSON.parse(row.definition));
  return compileBlueprint(def);
}
