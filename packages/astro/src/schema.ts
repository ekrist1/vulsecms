import { type ZodTypeAny, z } from 'zod';

interface FieldMeta {
  name: string;
  optional: boolean;
  ui: { kind: string; options?: string[] };
}

interface BlueprintMeta {
  handle: string;
  fields: FieldMeta[];
}

/**
 * Fetch the public schema metadata for a collection and translate it
 * into a Zod schema. Used as the loader's default `schema` — if the
 * user supplies their own `schema` to `defineCollection`, Astro uses
 * that instead.
 *
 * Simple field kinds (text, textarea, date, boolean, select) translate
 * to their Zod equivalents. Complex kinds (blocks, replicator,
 * relationship, asset) fall back to `z.unknown()` — the loader still
 * works, but supply your own schema in `defineCollection` if you need
 * strict runtime validation for those fields.
 */
export async function vulseSchemaFor(
  baseUrl: string,
  collection: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ZodTypeAny> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/public/_meta/collections`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Vulse responded ${res.status} fetching meta for ${collection}`);
  }
  const meta = (await res.json()) as BlueprintMeta[];
  const target = meta.find((m) => m.handle === collection);
  if (!target) {
    throw new Error(`Vulse collection not found in meta: ${collection}`);
  }
  return blueprintToZod(target);
}

export function blueprintToZod(blueprint: BlueprintMeta): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of blueprint.fields) {
    const base = fieldToZod(field);
    shape[field.name] = field.optional ? base.optional() : base;
  }
  return z.object(shape);
}

function fieldToZod(field: FieldMeta): ZodTypeAny {
  switch (field.ui.kind) {
    case 'text':
    case 'textarea':
    case 'date':
      return z.string();
    case 'boolean':
      return z.boolean();
    case 'select': {
      const options = field.ui.options ?? [];
      if (options.length === 0) return z.string();
      return z.enum(options as [string, ...string[]]);
    }
    // blocks, replicator, relationship, asset → unknown so the loader
    // doesn't fail validation on rich content. Override per-collection
    // in `defineCollection` if you want stricter checks.
    default:
      return z.unknown();
  }
}
