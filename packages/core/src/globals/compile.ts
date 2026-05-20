import type { z } from 'zod';
import { compileBlueprint } from '../blueprints/compile.js';
import type { FieldDefinition } from '../blueprints/definition.js';
import { type GlobalSetDefinition, hashGlobalSetDefinition } from './definition.js';

export interface CompiledGlobalSet {
  handle: string;
  label: string;
  fields: FieldDefinition[];
  schema: z.ZodObject<z.ZodRawShape>;
  hash: string;
}

export function compileGlobalSet(def: GlobalSetDefinition): CompiledGlobalSet {
  const compiled = compileBlueprint({
    handle: def.handle,
    label: def.label,
    singleton: true,
    fields: def.fields,
  });

  return {
    handle: compiled.handle,
    label: compiled.label,
    fields: compiled.fields,
    schema: compiled.schema,
    hash: hashGlobalSetDefinition(def),
  };
}
