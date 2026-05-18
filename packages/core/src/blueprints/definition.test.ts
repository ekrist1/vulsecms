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
      fields: [{ name: 'body', ui: { kind: 'blocks', sets: ['quote', 'gallery'] }, optional: false }],
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
