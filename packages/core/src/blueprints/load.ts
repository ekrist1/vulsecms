import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { z } from 'zod';
import type { DatabaseAdapter } from '@vulse/db';
import { Collection } from './collection.js';
import type { Blueprint, FieldMeta, FieldUi } from './types.js';

export interface LoadOptions {
  adapter: DatabaseAdapter;
}

export async function loadBlueprints(
  dir: string,
  opts: LoadOptions,
): Promise<Map<string, Blueprint>> {
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
    .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.js'))
    .filter((f) => !f.startsWith('_'));

  const map = new Map<string, Blueprint>();
  for (const file of files) {
    const mod = await import(pathToFileURL(resolve(dir, file)).href);
    const cls = mod.default as typeof Collection | undefined;
    if (!cls || !('handle' in cls) || !('schema' in cls)) continue;

    const blueprint = buildBlueprint(cls);
    map.set(blueprint.handle, blueprint);
    await upsertCollection(opts.adapter, blueprint);
  }
  return map;
}

function buildBlueprint(cls: typeof Collection): Blueprint {
  const handle = cls.handle;
  const label = cls.label ?? handle;
  const schema = cls.schema;
  const fields = extractFields(schema);
  const hash = hashBlueprint(handle, fields);
  return { handle, label, schema, fields, hash };
}

function extractFields(schema: z.ZodObject<z.ZodRawShape>): FieldMeta[] {
  const shape = schema.shape;
  const out: FieldMeta[] = [];
  for (const [name, fieldSchema] of Object.entries(shape)) {
    const meta = (fieldSchema as { meta?: () => { ui?: FieldUi } }).meta?.();
    const ui = meta?.ui;
    if (!ui) {
      throw new Error(
        `field '${name}' is missing .meta({ ui: { kind: ... } })`,
      );
    }
    out.push({
      name,
      ui,
      optional:
        (fieldSchema as { _zod?: { optin?: string } })._zod?.optin === 'optional',
      default: extractDefault(fieldSchema),
    });
  }
  return out;
}

function extractDefault(schema: unknown): unknown {
  const def = (schema as { _def?: { defaultValue?: () => unknown } })._def;
  if (def && typeof def.defaultValue === 'function') return def.defaultValue();
  return undefined;
}

function hashBlueprint(handle: string, fields: FieldMeta[]): string {
  const canonical = JSON.stringify({
    handle,
    fields: fields.map((f) => ({
      name: f.name,
      ui: f.ui,
      optional: f.optional,
      default: f.default ?? null,
    })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

async function upsertCollection(db: DatabaseAdapter, b: Blueprint): Promise<void> {
  await db.exec(
    `INSERT INTO collections (handle, blueprint_hash, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(handle) DO UPDATE SET blueprint_hash = excluded.blueprint_hash, updated_at = excluded.updated_at`,
    [b.handle, b.hash],
  );
}
