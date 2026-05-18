import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  BlueprintDefinition,
  FieldDefinition,
  NestedFieldDefinition,
  ReplicatorSetDefinition,
} from './definition.js';
import type { Blueprint } from './types.js';
import type { CompiledSet } from '../sets/compile.js';
import { validateSetNodes } from '../sets/validate-tree.js';

export interface CompileBlueprintOptions {
  sets?: Map<string, CompiledSet>;
}

export function compileBlueprint(
  def: BlueprintDefinition,
  options: CompileBlueprintOptions = {},
): Blueprint {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of def.fields) {
    shape[f.name] = compileField(f, options.sets);
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

function compileField(
  f: FieldDefinition,
  sets: Map<string, CompiledSet> | undefined,
): z.ZodTypeAny {
  return compileFieldBase(f, true, sets);
}

function compileFieldBase(
  f: FieldDefinition | NestedFieldDefinition,
  allowReplicator: boolean,
  sets: Map<string, CompiledSet> | undefined,
): z.ZodTypeAny {
  let s: z.ZodTypeAny = z.never();
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
    case 'blocks': {
      const declaredSets = (f.ui as { sets?: string[] }).sets;
      if (declaredSets?.length && sets) {
        s = z.any().superRefine((value, refinementCtx) => {
          validateSetNodes(value, [], sets, refinementCtx);
        });
      } else {
        s = z.any();
      }
      break;
    }
    case 'relationship':
      s = z.string();
      break;
    case 'replicator':
      if (!allowReplicator) {
        s = z.never();
        break;
      }
      s = compileReplicatorField(f.ui.sets);
      break;
  }
  if (f.default !== undefined) s = s.default(f.default);
  if (f.optional) s = s.optional();
  return s.meta({ ui: f.ui });
}

function compileReplicatorField(sets: ReplicatorSetDefinition[]): z.ZodTypeAny {
  const schemas = sets.map((set) =>
    z.object({
      set: z.literal(set.name),
      content: compileFieldObject(set.fields),
    }),
  );

  if (schemas.length === 1) return z.array(schemas[0]!);
  const [first, second, ...rest] = schemas;
  return z.array(z.discriminatedUnion('set', [first!, second!, ...rest]));
}

export function compileFieldObject(fields: NestedFieldDefinition[]): z.ZodObject<z.ZodRawShape> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.name] = compileFieldBase(field, false, undefined);
  }
  return z.object(shape);
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
