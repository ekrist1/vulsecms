import type { DatabaseAdapter } from '@vulse/db';
import { NotFoundError, ValidationError } from '../errors.js';
import { blueprintEvents } from '../events.js';
import { hashDefinition } from './compile.js';
import {
  type BlueprintDefinition,
  BlueprintDefinitionSchema,
  type BlueprintDefinitionWithRenames,
  BlueprintDefinitionWithRenamesSchema,
  type FieldDefinitionWithRename,
  type FieldUi,
  type NestedFieldDefinition,
} from './definition.js';

export async function createBlueprint(
  db: DatabaseAdapter,
  input: BlueprintDefinition,
): Promise<BlueprintDefinition> {
  const def = await validateNew(db, input);
  await db.exec(
    `INSERT INTO collections (handle, definition, blueprint_hash, singleton)
     VALUES (?, ?, ?, ?)`,
    [def.handle, JSON.stringify(def), hashDefinition(def), def.singleton ? 1 : 0],
  );
  blueprintEvents.emit('change', { handle: def.handle, kind: 'create' });
  return def;
}

export async function updateBlueprint(
  db: DatabaseAdapter,
  handle: string,
  input: BlueprintDefinitionWithRenames,
): Promise<BlueprintDefinition> {
  const existing = await loadDefinition(db, handle);
  if (!existing) throw new NotFoundError(`blueprint not found: ${handle}`);

  // Enforce handle immutability: ignore any handle in body, use URL param.
  const incoming = { ...input, handle };
  const parsed = parseOrThrow(BlueprintDefinitionWithRenamesSchema, incoming);

  // Validate previousName values against the prior definition.
  const oldNames = new Set(existing.fields.map((f) => f.name));
  for (const f of parsed.fields) {
    if (f.previousName !== undefined && !oldNames.has(f.previousName)) {
      throw new ValidationError([
        {
          code: 'custom',
          message: `previousName '${f.previousName}' was not in the prior definition`,
          path: ['fields', parsed.fields.indexOf(f), 'previousName'],
        } as never,
      ]);
    }
  }

  await ensureValidCrossField(db, parsed, handle);

  const renames = computeRenames(parsed.fields);
  const canonical: BlueprintDefinition = stripRenames(parsed);

  await db.transaction(async (tx) => {
    for (const [oldName, newName] of renames) {
      await tx.exec(
        `UPDATE entries
         SET content = json_set(
           json_remove(content, '$.' || ?),
           '$.' || ?,
           json_extract(content, '$.' || ?)
         )
         WHERE collection_handle = ? AND json_extract(content, '$.' || ?) IS NOT NULL`,
        [oldName, newName, oldName, handle, oldName],
      );
    }
    await tx.exec(
      `UPDATE collections
       SET definition = ?, blueprint_hash = ?, singleton = ?, updated_at = datetime('now')
       WHERE handle = ?`,
      [JSON.stringify(canonical), hashDefinition(canonical), canonical.singleton ? 1 : 0, handle],
    );
  });

  blueprintEvents.emit('change', { handle, kind: 'update' });
  return canonical;
}

export async function deleteBlueprint(db: DatabaseAdapter, handle: string): Promise<void> {
  const existing = await db.queryOne<{ handle: string }>(
    'SELECT handle FROM collections WHERE handle = ?',
    [handle],
  );
  if (!existing) throw new NotFoundError(`blueprint not found: ${handle}`);
  await db.exec('DELETE FROM collections WHERE handle = ?', [handle]);
  blueprintEvents.emit('change', { handle, kind: 'delete' });
}

// ---- helpers ----

async function validateNew(
  db: DatabaseAdapter,
  input: BlueprintDefinition,
): Promise<BlueprintDefinition> {
  const def = parseOrThrow(BlueprintDefinitionSchema, input);
  const dup = await db.queryOne<{ handle: string }>(
    'SELECT handle FROM collections WHERE handle = ?',
    [def.handle],
  );
  if (dup) {
    throw new ValidationError([
      {
        code: 'custom',
        message: `handle '${def.handle}' already exists`,
        path: ['handle'],
      } as never,
    ]);
  }
  await ensureValidCrossField(db, def, null);
  return def;
}

async function ensureValidCrossField(
  db: DatabaseAdapter,
  def: BlueprintDefinition | BlueprintDefinitionWithRenames,
  selfHandle: string | null,
): Promise<void> {
  await ensureValidFieldList(db, def.fields, ['fields'], selfHandle ?? def.handle);
}

async function ensureValidFieldList(
  db: DatabaseAdapter,
  fields: Array<{ name: string; ui: FieldUi } | NestedFieldDefinition>,
  path: Array<string | number>,
  currentHandle: string,
): Promise<void> {
  const seen = new Set<string>();
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    if (seen.has(f.name)) {
      throw new ValidationError([
        {
          code: 'custom',
          message: `duplicate field name '${f.name}'`,
          path: [...path, i, 'name'],
        } as never,
      ]);
    }
    seen.add(f.name);
  }

  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    if (f.ui.kind === 'relationship' && 'to' in f.ui) {
      if (f.ui.to === currentHandle) continue;
      const target = await db.queryOne<{ handle: string }>(
        'SELECT handle FROM collections WHERE handle = ?',
        [f.ui.to],
      );
      if (!target) {
        throw new ValidationError([
          {
            code: 'custom',
            message: `relationship target '${f.ui.to}' does not exist`,
            path: [...path, i, 'ui', 'to'],
          } as never,
        ]);
      }
    }

    if (f.ui.kind === 'replicator' && 'sets' in f.ui) {
      const seenSets = new Set<string>();
      for (let j = 0; j < f.ui.sets.length; j++) {
        const set = f.ui.sets[j]!;
        if (seenSets.has(set.name)) {
          throw new ValidationError([
            {
              code: 'custom',
              message: `duplicate set name '${set.name}'`,
              path: [...path, i, 'ui', 'sets', j, 'name'],
            } as never,
          ]);
        }
        seenSets.add(set.name);
        await ensureValidFieldList(
          db,
          set.fields,
          [...path, i, 'ui', 'sets', j, 'fields'],
          currentHandle,
        );
      }
    }
  }
}

function computeRenames(fields: FieldDefinitionWithRename[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const f of fields) {
    if (f.previousName !== undefined && f.previousName !== f.name) {
      out.push([f.previousName, f.name]);
    }
  }
  return out;
}

function stripRenames(def: BlueprintDefinitionWithRenames): BlueprintDefinition {
  return {
    handle: def.handle,
    label: def.label,
    singleton: def.singleton,
    ...(def.tree !== undefined ? { tree: def.tree } : {}),
    ...(def.maxDepth !== undefined ? { maxDepth: def.maxDepth } : {}),
    ...(def.drafts !== undefined ? { drafts: def.drafts } : {}),
    fields: def.fields.map(({ previousName: _previousName, ...rest }) => rest),
  };
}

async function loadDefinition(
  db: DatabaseAdapter,
  handle: string,
): Promise<BlueprintDefinition | null> {
  const row = await db.queryOne<{ definition: string | null }>(
    'SELECT definition FROM collections WHERE handle = ?',
    [handle],
  );
  if (!row || !row.definition) return null;
  return BlueprintDefinitionSchema.parse(JSON.parse(row.definition));
}

function parseOrThrow<T>(
  schema: {
    safeParse: (
      x: unknown,
    ) => { success: true; data: T } | { success: false; error: { issues: unknown[] } };
  },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(result.error.issues as never);
  }
  return result.data;
}
