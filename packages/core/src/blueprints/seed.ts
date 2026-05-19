import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseAdapter } from '@vulse/db';
import type { Collection } from './collection.js';
import { hashDefinition } from './compile.js';
import type { BlueprintDefinition, FieldDefinition, FieldUi } from './definition.js';

export interface SeedOptions {
  adapter: DatabaseAdapter;
  dir: string;
}

export async function seedBlueprintsFromCode(opts: SeedOptions): Promise<void> {
  const files = (await readdir(opts.dir))
    .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.js'))
    .filter((f) => !f.startsWith('_'));

  for (const file of files) {
    const mod = await import(pathToFileURL(resolve(opts.dir, file)).href);
    const cls = mod.default as typeof Collection | undefined;
    if (!cls || !('handle' in cls) || !('schema' in cls)) continue;

    const existing = await opts.adapter.queryOne<{ handle: string }>(
      'SELECT handle FROM collections WHERE handle = ?',
      [cls.handle],
    );
    if (existing) continue;

    const definition = classToDefinition(cls);
    await opts.adapter.exec(
      `INSERT INTO collections (handle, definition, blueprint_hash, singleton)
       VALUES (?, ?, ?, ?)`,
      [definition.handle, JSON.stringify(definition), hashDefinition(definition), 0],
    );
  }
}

function classToDefinition(cls: typeof Collection): BlueprintDefinition {
  const fields: FieldDefinition[] = [];
  const shape = cls.schema.shape;
  for (const [name, fieldSchema] of Object.entries(shape)) {
    const meta = (fieldSchema as { meta?: () => { ui?: FieldUi } }).meta?.();
    const ui = meta?.ui;
    if (!ui) throw new Error(`field '${name}' in '${cls.handle}' is missing .meta({ ui })`);
    fields.push({
      name,
      label: titleCase(name),
      ui,
      optional: (fieldSchema as { _zod?: { optin?: string } })._zod?.optin === 'optional',
      default: extractDefault(fieldSchema),
      validation: extractValidation(fieldSchema),
    });
  }
  return {
    handle: cls.handle,
    label: cls.label ?? cls.handle,
    singleton: false,
    ...(cls.tree ? { tree: true } : {}),
    ...(cls.maxDepth !== undefined ? { maxDepth: cls.maxDepth } : {}),
    ...(cls.drafts ? { drafts: true } : {}),
    fields,
  };
}

function titleCase(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function extractDefault(schema: unknown): unknown {
  const def = (schema as { _def?: { defaultValue?: () => unknown } })._def;
  if (def && typeof def.defaultValue === 'function') return def.defaultValue();
  return undefined;
}

function extractValidation(schema: unknown): { min?: number; max?: number } | undefined {
  const def = (schema as { _def?: { checks?: unknown[] } })._def;
  const checks = def?.checks;
  if (!checks || !Array.isArray(checks)) return undefined;
  const out: { min?: number; max?: number } = {};
  for (const c of checks) {
    const cdef = (c as { _zod?: { def?: { check?: string; minimum?: number; maximum?: number } } })
      ._zod?.def;
    if (!cdef) continue;
    if (cdef.check === 'min_length' && typeof cdef.minimum === 'number') out.min = cdef.minimum;
    if (cdef.check === 'max_length' && typeof cdef.maximum === 'number') out.max = cdef.maximum;
  }
  return Object.keys(out).length ? out : undefined;
}
