import { describe, expect, it } from 'vitest';
import { BlueprintDefinitionSchema } from './definition.js';

describe('BlueprintDefinitionSchema blocks-with-sets', () => {
  const base = {
    handle: 'posts',
    label: 'Posts',
    singleton: false,
  };

  it('accepts a blocks field with no sets', () => {
    const r = BlueprintDefinitionSchema.safeParse({
      ...base,
      fields: [{ name: 'body', ui: { kind: 'blocks' }, optional: false }],
    });
    expect(r.success).toBe(true);
  });

  it('accepts a blocks field with sets array', () => {
    const r = BlueprintDefinitionSchema.safeParse({
      ...base,
      fields: [
        { name: 'body', ui: { kind: 'blocks', sets: ['quote', 'gallery'] }, optional: false },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid set handle in sets array', () => {
    const r = BlueprintDefinitionSchema.safeParse({
      ...base,
      fields: [{ name: 'body', ui: { kind: 'blocks', sets: ['BadHandle'] }, optional: false }],
    });
    expect(r.success).toBe(false);
  });
});

describe('BlueprintDefinitionSchema tree', () => {
  const base = {
    handle: 'pages',
    label: 'Pages',
    fields: [{ name: 'title', ui: { kind: 'text' }, optional: false }],
  };

  it('accepts tree: true on a non-singleton collection', () => {
    const r = BlueprintDefinitionSchema.safeParse({ ...base, singleton: false, tree: true });
    expect(r.success).toBe(true);
  });

  it('accepts maxDepth alongside tree: true', () => {
    const r = BlueprintDefinitionSchema.safeParse({
      ...base,
      singleton: false,
      tree: true,
      maxDepth: 3,
    });
    expect(r.success).toBe(true);
  });

  it('rejects singleton + tree together', () => {
    const r = BlueprintDefinitionSchema.safeParse({ ...base, singleton: true, tree: true });
    expect(r.success).toBe(false);
  });

  it('rejects maxDepth without tree: true', () => {
    const r = BlueprintDefinitionSchema.safeParse({ ...base, singleton: false, maxDepth: 3 });
    expect(r.success).toBe(false);
  });

  it('accepts a blueprint with no tree flag (defaults to false)', () => {
    const r = BlueprintDefinitionSchema.safeParse({ ...base, singleton: false });
    expect(r.success).toBe(true);
  });
});

describe('BlueprintDefinitionSchema drafts', () => {
  const base = {
    handle: 'posts',
    label: 'Posts',
    singleton: false,
    fields: [{ name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false }],
  };

  it('accepts a drafts: true blueprint', () => {
    const result = BlueprintDefinitionSchema.safeParse({
      ...base,
      drafts: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.drafts).toBe(true);
  });

  it('defaults drafts to false when omitted', () => {
    const result = BlueprintDefinitionSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.drafts).toBe(false);
  });
});
