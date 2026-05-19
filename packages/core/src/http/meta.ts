import type { Blueprint, FieldMeta } from '../blueprints/types.js';

export interface BlueprintMeta {
  handle: string;
  label: string;
  singleton: boolean;
  tree: boolean;
  maxDepth?: number;
  drafts?: boolean;
  fields: FieldMeta[];
}

export function toMeta(b: Blueprint): BlueprintMeta {
  return {
    handle: b.handle,
    label: b.label,
    singleton: b.singleton,
    tree: b.tree,
    ...(b.maxDepth !== undefined ? { maxDepth: b.maxDepth } : {}),
    ...(b.drafts ? { drafts: true } : {}),
    fields: b.fields,
  };
}
