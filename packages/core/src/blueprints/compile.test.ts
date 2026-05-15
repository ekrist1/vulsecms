import { describe, expect, it } from 'vitest';
import { compileBlueprint } from './compile.js';
import type { BlueprintDefinition } from './definition.js';

function bp(overrides: Partial<BlueprintDefinition> = {}): BlueprintDefinition {
  return {
    handle: 'posts',
    label: 'Posts',
    singleton: false,
    fields: [],
    ...overrides,
  };
}

describe('compileBlueprint', () => {
  it('compiles a text field with min/max', () => {
    const b = compileBlueprint(
      bp({
        fields: [
          { name: 'title', ui: { kind: 'text' }, optional: false, validation: { min: 1, max: 10 } },
        ],
      }),
    );
    expect(b.schema.safeParse({ title: 'ok' }).success).toBe(true);
    expect(b.schema.safeParse({ title: '' }).success).toBe(false);
    expect(b.schema.safeParse({ title: 'too long string' }).success).toBe(false);
  });

  it('compiles an optional textarea', () => {
    const b = compileBlueprint(
      bp({ fields: [{ name: 'bio', ui: { kind: 'textarea' }, optional: true }] }),
    );
    expect(b.schema.safeParse({}).success).toBe(true);
    expect(b.schema.safeParse({ bio: 'hi' }).success).toBe(true);
  });

  it('compiles a date field via coercion', () => {
    const b = compileBlueprint(
      bp({ fields: [{ name: 'publishAt', ui: { kind: 'date' }, optional: false }] }),
    );
    expect(b.schema.safeParse({ publishAt: '2026-01-01' }).success).toBe(true);
    expect(b.schema.safeParse({ publishAt: 'not a date' }).success).toBe(false);
  });

  it('compiles a boolean with a default', () => {
    const b = compileBlueprint(
      bp({
        fields: [{ name: 'isFeatured', ui: { kind: 'boolean' }, optional: false, default: false }],
      }),
    );
    const out = b.schema.safeParse({});
    expect(out.success).toBe(true);
    if (out.success) expect(out.data).toEqual({ isFeatured: false });
  });

  it('compiles a select that rejects values outside its options', () => {
    const b = compileBlueprint(
      bp({
        fields: [
          {
            name: 'status',
            ui: { kind: 'select', options: ['draft', 'published'] },
            optional: false,
          },
        ],
      }),
    );
    expect(b.schema.safeParse({ status: 'draft' }).success).toBe(true);
    expect(b.schema.safeParse({ status: 'archived' }).success).toBe(false);
  });

  it('compiles blocks as z.any() (accepts any shape)', () => {
    const b = compileBlueprint(
      bp({ fields: [{ name: 'body', ui: { kind: 'blocks' }, optional: false }] }),
    );
    expect(b.schema.safeParse({ body: { type: 'doc', content: [] } }).success).toBe(true);
  });

  it('compiles relationship as a string id', () => {
    const b = compileBlueprint(
      bp({
        fields: [
          { name: 'author', ui: { kind: 'relationship', to: 'authors' }, optional: false },
        ],
      }),
    );
    expect(b.schema.safeParse({ author: 'ulid-here' }).success).toBe(true);
    expect(b.schema.safeParse({ author: 123 }).success).toBe(false);
  });

  it('attaches ui meta to each field for the loader to extract', () => {
    const b = compileBlueprint(
      bp({ fields: [{ name: 'title', ui: { kind: 'text' }, optional: false }] }),
    );
    expect(b.fields[0]).toMatchObject({ name: 'title', ui: { kind: 'text' } });
  });

  it('produces a 64-char sha256 hash that is stable across compilations', () => {
    const def = bp({ fields: [{ name: 'title', ui: { kind: 'text' }, optional: false }] });
    const a = compileBlueprint(def);
    const c = compileBlueprint(def);
    expect(a.hash).toHaveLength(64);
    expect(a.hash).toBe(c.hash);
  });
});
