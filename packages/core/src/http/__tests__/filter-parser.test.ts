import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../errors.js';
import { parseListQuery } from '../filter-parser.js';

describe('parseListQuery', () => {
  it('returns empty filter/sort when query is empty', () => {
    expect(parseListQuery({})).toEqual({ filter: undefined, sort: undefined });
  });

  it('parses a single eq filter', () => {
    expect(parseListQuery({ 'filter[status][eq]': 'published' })).toEqual({
      filter: { status: { eq: 'published' } },
      sort: undefined,
    });
  });

  it('parses IN with comma-separated values', () => {
    expect(parseListQuery({ 'filter[status][in]': 'published,scheduled' })).toEqual({
      filter: { status: { in: ['published', 'scheduled'] } },
      sort: undefined,
    });
  });

  it('merges multiple operators on one field', () => {
    expect(
      parseListQuery({
        'filter[publishedAt][gte]': '2024-01-01',
        'filter[publishedAt][lt]': '2025-01-01',
      }),
    ).toEqual({
      filter: { publishedAt: { gte: '2024-01-01', lt: '2025-01-01' } },
      sort: undefined,
    });
  });

  it('parses sort with minus prefix as desc', () => {
    expect(parseListQuery({ sort: '-publishedAt' })).toEqual({
      filter: undefined,
      sort: [{ field: 'publishedAt', direction: 'desc' }],
    });
  });

  it('parses multi-sort comma-separated', () => {
    expect(parseListQuery({ sort: '-publishedAt,title' })).toEqual({
      filter: undefined,
      sort: [
        { field: 'publishedAt', direction: 'desc' },
        { field: 'title', direction: 'asc' },
      ],
    });
  });

  it('throws ValidationError on malformed filter key (no operator)', () => {
    expect(() => parseListQuery({ 'filter[status]': 'published' })).toThrow(ValidationError);
  });

  it('throws ValidationError on unknown filter operator', () => {
    expect(() => parseListQuery({ 'filter[status][bogus]': 'x' })).toThrow(ValidationError);
  });

  it('throws ValidationError on empty filter field name', () => {
    expect(() => parseListQuery({ 'filter[][eq]': 'x' })).toThrow(ValidationError);
  });

  it('throws ValidationError on empty sort', () => {
    expect(() => parseListQuery({ sort: '' })).toThrow(ValidationError);
    expect(() => parseListQuery({ sort: '-' })).toThrow(ValidationError);
  });

  it('ignores other query params (limit, offset, q, field)', () => {
    expect(
      parseListQuery({
        limit: '20',
        offset: '0',
        q: 'climate',
        field: 'title',
        'filter[status][eq]': 'published',
      }),
    ).toEqual({
      filter: { status: { eq: 'published' } },
      sort: undefined,
    });
  });
});
