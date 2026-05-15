import type { z } from 'zod';

export interface FieldUi {
  kind: 'text' | 'textarea' | 'blocks' | 'date' | 'boolean' | 'select' | 'relationship';
  options?: readonly string[];
  to?: string;
}

export interface FieldMeta {
  name: string;
  ui: FieldUi;
  optional: boolean;
  default?: unknown;
}

export interface Blueprint {
  handle: string;
  label: string;
  schema: z.ZodObject<z.ZodRawShape>;
  fields: FieldMeta[];
  hash: string;
}
