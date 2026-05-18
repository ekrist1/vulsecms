import type { z } from 'zod';
import type { FieldDefinition, FieldUi } from './definition.js';

export type { FieldUi, FieldDefinition } from './definition.js';

// Backwards-compat alias: prior code referred to FieldMeta. Keep it as an
// alias for FieldDefinition so the admin client code keeps compiling.
export type FieldMeta = FieldDefinition;

export interface Blueprint {
  handle: string;
  label: string;
  singleton: boolean;
  tree: boolean;
  maxDepth?: number;
  schema: z.ZodObject<z.ZodRawShape>;
  fields: FieldDefinition[];
  hash: string;
}
