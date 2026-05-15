import { z } from 'zod';

// Stored JSON shape for a blueprint. The same shape is returned by the
// /api/blueprints endpoints and consumed by the admin editor.

export const FieldUiSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text') }),
  z.object({ kind: z.literal('textarea') }),
  z.object({ kind: z.literal('blocks') }),
  z.object({ kind: z.literal('date') }),
  z.object({ kind: z.literal('boolean') }),
  z.object({ kind: z.literal('select'), options: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal('relationship'), to: z.string().min(1) }),
]);

export const FieldValidationSchema = z
  .object({
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().positive().optional(),
  })
  .optional();

export const FieldDefinitionSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  label: z.string().optional(),
  ui: FieldUiSchema,
  optional: z.boolean(),
  default: z.unknown().optional(),
  validation: FieldValidationSchema,
});

export const BlueprintDefinitionSchema = z.object({
  handle: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  label: z.string().min(1),
  singleton: z.boolean(),
  fields: z.array(FieldDefinitionSchema).min(1),
});

export type FieldUi = z.infer<typeof FieldUiSchema>;
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;
export type BlueprintDefinition = z.infer<typeof BlueprintDefinitionSchema>;

// PATCH body adds previousName per field (server-only; stripped before persisting).
export const FieldDefinitionWithRenameSchema = FieldDefinitionSchema.extend({
  previousName: z.string().optional(),
});
export const BlueprintDefinitionWithRenamesSchema = BlueprintDefinitionSchema.extend({
  fields: z.array(FieldDefinitionWithRenameSchema).min(1),
});
export type FieldDefinitionWithRename = z.infer<typeof FieldDefinitionWithRenameSchema>;
export type BlueprintDefinitionWithRenames = z.infer<typeof BlueprintDefinitionWithRenamesSchema>;
