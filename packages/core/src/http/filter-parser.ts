import { ValidationError } from '../errors.js';
import type { FieldFilter, FilterValue, SortSpec } from '../content/types.js';

const VALID_OPS = new Set<keyof FieldFilter>(['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte']);

const FILTER_KEY_RE = /^filter\[([^\[\]]*)\]\[([a-z]+)\]$/;

export interface ParsedListQuery {
  filter: Record<string, FieldFilter> | undefined;
  sort: SortSpec[] | undefined;
}

export function parseListQuery(query: Record<string, string>): ParsedListQuery {
  const filter: Record<string, FieldFilter> = {};
  let sort: SortSpec[] | undefined;
  let sawFilter = false;

  for (const [rawKey, rawValue] of Object.entries(query)) {
    if (rawKey === 'sort') {
      sort = parseSort(rawValue);
      continue;
    }
    if (!rawKey.startsWith('filter')) continue;
    const match = FILTER_KEY_RE.exec(rawKey);
    if (!match) {
      throw new ValidationError([
        { code: 'custom', message: `Malformed filter key: ${rawKey}`, path: ['filter'] },
      ]);
    }
    const field = match[1];
    const op = match[2] as string;
    if (!field) {
      throw new ValidationError([
        { code: 'custom', message: `Empty field in filter key: ${rawKey}`, path: ['filter'] },
      ]);
    }
    if (!VALID_OPS.has(op as keyof FieldFilter)) {
      throw new ValidationError([
        {
          code: 'custom',
          message: `Unknown filter operator '${op}' for field '${field}'.`,
          path: ['filter', field],
        },
      ]);
    }
    const bucket = (filter[field] ??= {});
    if (op === 'in') {
      const values = rawValue
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      (bucket as FieldFilter).in = values as FilterValue[];
    } else {
      (bucket as Record<string, FilterValue>)[op] = rawValue;
    }
    sawFilter = true;
  }

  return {
    filter: sawFilter ? filter : undefined,
    sort,
  };
}

function parseSort(raw: string): SortSpec[] {
  if (!raw || raw.trim() === '') {
    throw new ValidationError([{ code: 'custom', message: 'Empty sort value.', path: ['sort'] }]);
  }
  const segments = raw.split(',').map((s) => s.trim());
  return segments.map((seg) => {
    if (!seg || seg === '-') {
      throw new ValidationError([
        { code: 'custom', message: `Empty sort segment in '${raw}'.`, path: ['sort'] },
      ]);
    }
    const descending = seg.startsWith('-');
    const field = descending ? seg.slice(1) : seg;
    if (!field) {
      throw new ValidationError([
        { code: 'custom', message: `Empty sort field in '${seg}'.`, path: ['sort'] },
      ]);
    }
    return { field, direction: descending ? 'desc' : 'asc' };
  });
}
