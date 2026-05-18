import { describe, expect, it } from 'vitest';
import { compileSet } from '../../sets/compile.js';
import { compileBlueprint } from '../compile.js';

const quote = compileSet({
  handle: 'quote',
  label: 'Quote',
  fields: [{ name: 'q', ui: { kind: 'text' }, optional: false }],
});
const sets = new Map([['quote', quote]]);

describe('compileBlueprint with blocks-with-sets', () => {
  const def = {
    handle: 'posts',
    label: 'Posts',
    singleton: false,
    fields: [
      { name: 'body', ui: { kind: 'blocks' as const, sets: ['quote'] }, optional: false },
    ],
  };

  it('accepts valid body with a good set node', () => {
    const bp = compileBlueprint(def, { sets });
    const ok = bp.schema.safeParse({
      body: {
        type: 'doc',
        content: [{ type: 'vulseSet', attrs: { set: 'quote', data: { q: 'hi' } } }],
      },
    });
    expect(ok.success).toBe(true);
  });

  it('rejects body with a missing required set field', () => {
    const bp = compileBlueprint(def, { sets });
    const bad = bp.schema.safeParse({
      body: {
        type: 'doc',
        content: [{ type: 'vulseSet', attrs: { set: 'quote', data: {} } }],
      },
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const paths = bad.error.issues.map((i) => i.path.join('.'));
      expect(paths.some((p) => p.includes('body.content.0.data.q'))).toBe(true);
    }
  });

  it('rejects body referencing an unknown set', () => {
    const bp = compileBlueprint(def, { sets });
    const bad = bp.schema.safeParse({
      body: {
        type: 'doc',
        content: [{ type: 'vulseSet', attrs: { set: 'gallery', data: {} } }],
      },
    });
    expect(bad.success).toBe(false);
  });

  it('blocks field with no sets falls through to z.any()', () => {
    const noSets = {
      ...def,
      fields: [{ name: 'body', ui: { kind: 'blocks' as const }, optional: false }],
    };
    const bp = compileBlueprint(noSets, { sets });
    // Any tree shape goes through.
    expect(bp.schema.safeParse({ body: { anything: 1 } }).success).toBe(true);
  });
});
