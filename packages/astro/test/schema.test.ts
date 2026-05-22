import { describe, expect, it, vi } from 'vitest';
import { blueprintToZod, vulseSchemaFor } from '../src/schema.js';

describe('blueprintToZod', () => {
  it('translates basic field kinds to Zod primitives', () => {
    const schema = blueprintToZod({
      handle: 'posts',
      fields: [
        { name: 'title', optional: false, ui: { kind: 'text' } },
        { name: 'body', optional: false, ui: { kind: 'textarea' } },
        { name: 'publishedAt', optional: true, ui: { kind: 'date' } },
        { name: 'draft', optional: false, ui: { kind: 'boolean' } },
      ],
    });
    expect(
      schema.safeParse({ title: 'A', body: 'B', publishedAt: '2026-01-01', draft: false }).success,
    ).toBe(true);
    expect(schema.safeParse({ title: 123, body: 'B', draft: false }).success).toBe(false);
  });

  it('handles optional fields', () => {
    const schema = blueprintToZod({
      handle: 'posts',
      fields: [
        { name: 'title', optional: false, ui: { kind: 'text' } },
        { name: 'subtitle', optional: true, ui: { kind: 'text' } },
      ],
    });
    expect(schema.safeParse({ title: 'A' }).success).toBe(true);
    expect(schema.safeParse({ subtitle: 'only' }).success).toBe(false);
  });

  it('translates select fields with options into z.enum', () => {
    const schema = blueprintToZod({
      handle: 'posts',
      fields: [
        {
          name: 'status',
          optional: false,
          ui: { kind: 'select', options: ['draft', 'published'] },
        },
      ],
    });
    expect(schema.safeParse({ status: 'draft' }).success).toBe(true);
    expect(schema.safeParse({ status: 'other' }).success).toBe(false);
  });

  it('falls back to z.unknown() for complex field kinds (blocks, asset, …)', () => {
    const schema = blueprintToZod({
      handle: 'posts',
      fields: [
        { name: 'body', optional: false, ui: { kind: 'blocks' } },
        { name: 'cover', optional: true, ui: { kind: 'asset' } },
      ],
    });
    // Any shape passes — that's the point of unknown for rich content.
    expect(schema.safeParse({ body: { type: 'doc', content: [] } }).success).toBe(true);
    expect(schema.safeParse({ body: 'whatever' }).success).toBe(true);
  });
});

describe('vulseSchemaFor', () => {
  it('fetches /api/public/_meta/collections and finds the matching blueprint', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              handle: 'authors',
              fields: [{ name: 'name', optional: false, ui: { kind: 'text' } }],
            },
            {
              handle: 'posts',
              fields: [
                { name: 'title', optional: false, ui: { kind: 'text' } },
                { name: 'draft', optional: true, ui: { kind: 'boolean' } },
              ],
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const schema = await vulseSchemaFor(
      'http://vulse.test',
      'posts',
      fetchImpl as unknown as typeof fetch,
    );
    expect(schema.safeParse({ title: 'Hi' }).success).toBe(true);
    expect(schema.safeParse({ title: 'Hi', draft: true }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(fetchImpl).toHaveBeenCalledWith('http://vulse.test/api/public/_meta/collections');
  });

  it('throws when the collection is missing from the meta response', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify([{ handle: 'authors', fields: [] }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(
      vulseSchemaFor('http://vulse.test', 'posts', fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/not found/);
  });
});
