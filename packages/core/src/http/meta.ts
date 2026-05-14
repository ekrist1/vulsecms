import type { Blueprint, FieldMeta } from '../blueprints/types.js';

export interface BlueprintMeta {
  handle: string;
  label: string;
  fields: FieldMeta[];
}

export function toMeta(b: Blueprint): BlueprintMeta {
  return { handle: b.handle, label: b.label, fields: b.fields };
}
