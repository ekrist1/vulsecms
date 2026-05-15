import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Blueprint } from './types.js';
import type { BlueprintDefinition, FieldDefinition } from './definition.js';

export function compileBlueprint(def: BlueprintDefinition): Blueprint {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of def.fields) {
    shape[f.name] = compileField(f);
  }
  const schema = z.object(shape);
  return {
    handle: def.handle,
    label: def.label,
    singleton: def.singleton,
    fields: def.fields,
    schema,
    hash: hashDefinition(def),
  };
}

function compileField(f: FieldDefinition): z.ZodTypeAny {
  let s: z.ZodTypeAny;
  switch (f.ui.kind) {
    case 'text':
    case 'textarea': {
      let str = z.string();
      if (f.validation?.min !== undefined) str = str.min(f.validation.min);
      if (f.validation?.max !== undefined) str = str.max(f.validation.max);
      s = str;
      break;
    }
    case 'date':
      s = z.coerce.date();
      break;
    case 'boolean':
      s = z.boolean();
      break;
    case 'select':
      s = z.enum(f.ui.options as [string, ...string[]]);
      break;
    case 'blocks':
      s = z.any();
      break;
    case 'relationship':
      s = z.string();
      break;
  }
  if (f.default !== undefined) s = s.default(f.default);
  if (f.optional) s = s.optional();
  return s.meta({ ui: f.ui });
}

export function hashDefinition(def: BlueprintDefinition): string {
  const canonical = JSON.stringify({
    handle: def.handle,
    label: def.label,
    singleton: def.singleton,
    fields: def.fields.map((f) => ({
      name: f.name,
      label: f.label ?? null,
      ui: f.ui,
      optional: f.optional,
      default: f.default ?? null,
      validation: f.validation ?? null,
    })),
  });
  return createHash('sha256').update(canonical).digest('hex');
}
