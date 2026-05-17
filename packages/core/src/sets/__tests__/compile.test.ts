import { describe, expect, it } from 'vitest';
import { compileSet } from '../compile.js';
import type { SetDefinition } from '../definition.js';

const quoteSet: SetDefinition = {
  handle: 'quote',
  label: 'Quote',
  fields: [
    { name: 'quote', label: 'Quote', ui: { kind: 'textarea' }, optional: false },
    { name: 'author', label: 'Author', ui: { kind: 'text' }, optional: false },
  ],
};

describe('compileSet', () => {
  it('returns { definition, schema }', () => {
    const c = compileSet(quoteSet);
    expect(c.definition.handle).toBe('quote');
    expect(c.schema).toBeDefined();
  });

  it('schema accepts valid data', () => {
    const c = compileSet(quoteSet);
    const ok = c.schema.safeParse({ quote: 'Lorem', author: 'Anna' });
    expect(ok.success).toBe(true);
  });

  it('schema rejects missing required field', () => {
    const c = compileSet(quoteSet);
    const bad = c.schema.safeParse({ quote: 'Lorem' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const paths = bad.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('author');
    }
  });

  it('honors optional fields', () => {
    const def: SetDefinition = {
      handle: 'q',
      label: 'Q',
      fields: [{ name: 'note', ui: { kind: 'text' }, optional: true }],
    };
    const c = compileSet(def);
    expect(c.schema.safeParse({}).success).toBe(true);
  });
});
