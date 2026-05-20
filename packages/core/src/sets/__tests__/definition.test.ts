import { describe, expect, it } from 'vitest';
import { SetDefinitionSchema } from '../definition.js';

describe('SetDefinitionSchema', () => {
  it('accepts a valid set with one text field', () => {
    const ok = SetDefinitionSchema.safeParse({
      handle: 'quote',
      label: 'Quote',
      fields: [{ name: 'quote', label: 'Quote', ui: { kind: 'text' }, optional: false }],
    });
    expect(ok.success).toBe(true);
  });

  it('rejects handle with uppercase or invalid chars', () => {
    const r1 = SetDefinitionSchema.safeParse({
      handle: 'Quote',
      label: 'Q',
      fields: [{ name: 'x', ui: { kind: 'text' }, optional: false }],
    });
    expect(r1.success).toBe(false);
    const r2 = SetDefinitionSchema.safeParse({
      handle: '1quote',
      label: 'Q',
      fields: [{ name: 'x', ui: { kind: 'text' }, optional: false }],
    });
    expect(r2.success).toBe(false);
  });

  it('rejects empty fields array', () => {
    const r = SetDefinitionSchema.safeParse({ handle: 'q', label: 'Q', fields: [] });
    expect(r.success).toBe(false);
  });

  it('rejects empty label', () => {
    const r = SetDefinitionSchema.safeParse({
      handle: 'q',
      label: '',
      fields: [{ name: 'x', ui: { kind: 'text' }, optional: false }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects nested replicator field inside set', () => {
    const r = SetDefinitionSchema.safeParse({
      handle: 'q',
      label: 'Q',
      fields: [
        {
          name: 'nested',
          ui: {
            kind: 'replicator',
            sets: [{ name: 's', fields: [{ name: 'x', ui: { kind: 'text' }, optional: false }] }],
          },
          optional: false,
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('accepts a blocks-kind nested field', () => {
    const r = SetDefinitionSchema.safeParse({
      handle: 'q',
      label: 'Q',
      fields: [{ name: 'body', ui: { kind: 'blocks' }, optional: false }],
    });
    expect(r.success).toBe(true);
  });
});
