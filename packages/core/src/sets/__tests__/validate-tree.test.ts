import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { compileSet, type CompiledSet } from '../compile.js';
import { validateSetNodes } from '../validate-tree.js';

const quote: CompiledSet = compileSet({
  handle: 'quote',
  label: 'Quote',
  fields: [
    { name: 'quote', ui: { kind: 'textarea' }, optional: false },
    { name: 'author', ui: { kind: 'text' }, optional: false },
  ],
});

const sets = new Map([['quote', quote]]);

function collect(doc: unknown): z.core.$ZodRawIssue[] {
  const issues: z.core.$ZodRawIssue[] = [];
  const ctx = {
    addIssue: (i: z.core.$ZodRawIssue) => issues.push(i),
  } as unknown as z.core.$RefinementCtx;
  validateSetNodes(doc, [], sets, ctx);
  return issues;
}

describe('validateSetNodes', () => {
  it('passes a valid vulseSet node', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
        { type: 'vulseSet', attrs: { set: 'quote', data: { quote: 'L', author: 'A' } } },
      ],
    };
    expect(collect(doc)).toHaveLength(0);
  });

  it('flags missing required field', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'vulseSet', attrs: { set: 'quote', data: { quote: 'L' } } },
      ],
    };
    const issues = collect(doc);
    expect(issues.length).toBeGreaterThan(0);
    expect((issues[0]!.path ?? []).join('.')).toContain('data.author');
  });

  it('flags unknown set handle', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'vulseSet', attrs: { set: 'unknown', data: {} } }],
    };
    const issues = collect(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('unknown set');
    expect((issues[0]!.path ?? []).join('.')).toContain('set');
  });

  it('walks nested content (set inside a block-quote)', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'blockquote',
        content: [{ type: 'vulseSet', attrs: { set: 'quote', data: { quote: 'L' } } }],
      }],
    };
    const issues = collect(doc);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('ignores non-tree inputs', () => {
    expect(collect(null)).toHaveLength(0);
    expect(collect('string')).toHaveLength(0);
    expect(collect(42)).toHaveLength(0);
  });
});
