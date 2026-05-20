import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../errors.js';
import type { Blueprint } from '../../blueprints/types.js';
import { buildFilterSql } from '../filter-sql.js';

function bp(extra?: Partial<Blueprint>): Blueprint {
  return {
    handle: 'posts',
    label: 'Posts',
    singleton: false,
    tree: false,
    schema: { safeParse: () => ({ success: true, data: {} }) } as unknown as Blueprint['schema'],
    fields: [
      { name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false },
      {
        name: 'status',
        label: 'Status',
        ui: { kind: 'select', options: ['draft', 'published', 'scheduled'] },
        optional: false,
      },
      { name: 'publishedAt', label: 'Published', ui: { kind: 'date' }, optional: true },
      { name: 'featured', label: 'Featured', ui: { kind: 'boolean' }, optional: true },
    ],
    ...extra,
  } as Blueprint;
}

describe('buildFilterSql', () => {
  it('returns empty fragment when filter is missing', () => {
    expect(buildFilterSql(undefined, bp())).toEqual({ sql: '', params: [] });
    expect(buildFilterSql({}, bp())).toEqual({ sql: '', params: [] });
  });

  it('builds equality on a top-level id column (plain SQL, no json_extract)', () => {
    const out = buildFilterSql({ id: { eq: 'abc' } }, bp());
    expect(out.sql).toBe(' AND id = ?');
    expect(out.params).toEqual(['abc']);
  });

  it('builds equality on a content field via json_extract', () => {
    const out = buildFilterSql({ status: { eq: 'published' } }, bp());
    expect(out.sql).toBe(' AND CAST(json_extract(content, ?) AS TEXT) = ?');
    expect(out.params).toEqual(['$.status', 'published']);
  });

  it('builds IN with multiple values', () => {
    const out = buildFilterSql({ status: { in: ['published', 'scheduled'] } }, bp());
    expect(out.sql).toBe(' AND CAST(json_extract(content, ?) AS TEXT) IN (?, ?)');
    expect(out.params).toEqual(['$.status', 'published', 'scheduled']);
  });

  it('builds IN with empty array as a false predicate', () => {
    const out = buildFilterSql({ status: { in: [] } }, bp());
    expect(out.sql).toBe(' AND 0');
    expect(out.params).toEqual([]);
  });

  it('ANDs multiple operators on one field', () => {
    const out = buildFilterSql({ publishedAt: { gte: '2024-01-01', lt: '2025-01-01' } }, bp());
    expect(out.sql).toBe(
      ' AND CAST(json_extract(content, ?) AS TEXT) >= ? AND CAST(json_extract(content, ?) AS TEXT) < ?',
    );
    expect(out.params).toEqual(['$.publishedAt', '2024-01-01', '$.publishedAt', '2025-01-01']);
  });

  it('ANDs multiple fields', () => {
    const out = buildFilterSql(
      { status: { eq: 'published' }, publishedAt: { gte: '2024-01-01' } },
      bp(),
    );
    expect(out.sql).toBe(
      ' AND CAST(json_extract(content, ?) AS TEXT) = ? AND CAST(json_extract(content, ?) AS TEXT) >= ?',
    );
    expect(out.params).toEqual(['$.status', 'published', '$.publishedAt', '2024-01-01']);
  });

  it('coerces boolean values for protected column', () => {
    const out = buildFilterSql({ protected: { eq: true } }, bp());
    expect(out.sql).toBe(' AND protected = ?');
    expect(out.params).toEqual([1]);
  });

  it('coerces "true"/"false" strings for boolean content fields', () => {
    const out = buildFilterSql({ featured: { eq: 'true' } }, bp());
    expect(out.params).toEqual(['$.featured', 1]);
  });

  it('throws ValidationError on unknown field', () => {
    expect(() => buildFilterSql({ nope: { eq: 'x' } }, bp())).toThrow(ValidationError);
  });

  it('throws ValidationError when a comparison operator is given a boolean field', () => {
    expect(() => buildFilterSql({ featured: { gt: true } }, bp())).toThrow(ValidationError);
  });
});
