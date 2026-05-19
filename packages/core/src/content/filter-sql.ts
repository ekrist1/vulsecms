import type { Blueprint, FieldDefinition } from '../blueprints/types.js';
import { ValidationError } from '../errors.js';
import type { FieldFilter, FilterValue, SortSpec } from './types.js';

const TOP_LEVEL_COLUMN_NAME: Record<string, string> = {
  id: 'id',
  status: 'status',
  parent_id: 'parent_id',
  parentId: 'parent_id',
  protected: 'protected',
  sort_order: 'sort_order',
  sortOrder: 'sort_order',
  created_at: 'created_at',
  createdAt: 'created_at',
  updated_at: 'updated_at',
  updatedAt: 'updated_at',
};

const BOOLEAN_TOP_LEVEL = new Set(['protected']);
const NUMERIC_TOP_LEVEL = new Set(['sort_order']);

const OP_SQL: Record<keyof FieldFilter, string> = {
  eq: '=',
  neq: '!=',
  in: 'IN',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

const OP_ORDER: Array<keyof FieldFilter> = ['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte'];

const COMPARISON_OPS = new Set<keyof FieldFilter>(['gt', 'gte', 'lt', 'lte']);

export interface SqlFragment {
  sql: string;
  params: unknown[];
}

interface ResolvedKey {
  kind: 'column' | 'content';
  expr: string;
  needsPathParam: boolean;
  pathParam?: string;
  field: FieldDefinition | null;
}

function resolveKey(key: string, b: Blueprint): ResolvedKey {
  // Blueprint content fields take priority over the top-level column map,
  // because a blueprint field named e.g. "status" lives in the JSON content,
  // not in the top-level SQL column of the same name.
  const field = b.fields.find((f) => f.name === key);
  if (field) {
    return {
      kind: 'content',
      expr: 'CAST(json_extract(content, ?) AS TEXT)',
      needsPathParam: true,
      pathParam: `$.${key}`,
      field,
    };
  }
  if (key in TOP_LEVEL_COLUMN_NAME) {
    return {
      kind: 'column',
      expr: TOP_LEVEL_COLUMN_NAME[key]!,
      needsPathParam: false,
      field: null,
    };
  }
  throw new ValidationError([
    { code: 'custom', message: `Unknown filter field: ${key}`, path: ['filter', key] },
  ]);
}

function isBooleanKey(key: string, resolved: ResolvedKey): boolean {
  if (BOOLEAN_TOP_LEVEL.has(TOP_LEVEL_COLUMN_NAME[key] ?? key)) return true;
  return resolved.field?.ui.kind === 'boolean';
}

function isNumericKey(key: string, resolved: ResolvedKey): boolean {
  if (NUMERIC_TOP_LEVEL.has(TOP_LEVEL_COLUMN_NAME[key] ?? key)) return true;
  return false;
}

function coerceValue(
  raw: FilterValue,
  key: string,
  resolved: ResolvedKey,
  op: keyof FieldFilter,
): unknown {
  if (isBooleanKey(key, resolved)) {
    if (COMPARISON_OPS.has(op)) {
      throw new ValidationError([
        {
          code: 'custom',
          message: `Operator '${op}' is not valid on boolean field '${key}'.`,
          path: ['filter', key, op],
        },
      ]);
    }
    if (raw === true || raw === 1 || raw === 'true' || raw === '1') return 1;
    if (raw === false || raw === 0 || raw === 'false' || raw === '0') return 0;
    throw new ValidationError([
      {
        code: 'custom',
        message: `Value '${String(raw)}' cannot be coerced to boolean for field '${key}'.`,
        path: ['filter', key, op],
      },
    ]);
  }
  if (isNumericKey(key, resolved)) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) {
      throw new ValidationError([
        {
          code: 'custom',
          message: `Value '${String(raw)}' cannot be coerced to number for field '${key}'.`,
          path: ['filter', key, op],
        },
      ]);
    }
    return n;
  }
  return typeof raw === 'string' ? raw : String(raw);
}

export function buildFilterSql(
  filter: Record<string, FieldFilter> | undefined,
  b: Blueprint,
): SqlFragment {
  if (!filter) return { sql: '', params: [] };
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const [key, ops] of Object.entries(filter)) {
    if (!ops || Object.keys(ops).length === 0) continue;
    const resolved = resolveKey(key, b);

    for (const op of OP_ORDER) {
      const raw = ops[op];
      if (raw === undefined) continue;

      if (op === 'in') {
        const values = Array.isArray(raw) ? raw : [];
        if (values.length === 0) {
          clauses.push('0');
          continue;
        }
        const placeholders = values.map(() => '?').join(', ');
        if (resolved.needsPathParam) {
          clauses.push(`${resolved.expr} IN (${placeholders})`);
          params.push(resolved.pathParam!);
        } else {
          clauses.push(`${resolved.expr} IN (${placeholders})`);
        }
        for (const v of values) params.push(coerceValue(v, key, resolved, op));
        continue;
      }

      const sqlOp = OP_SQL[op];
      const value = coerceValue(raw as FilterValue, key, resolved, op);
      if (resolved.needsPathParam) {
        clauses.push(`${resolved.expr} ${sqlOp} ?`);
        params.push(resolved.pathParam!, value);
      } else {
        clauses.push(`${resolved.expr} ${sqlOp} ?`);
        params.push(value);
      }
    }
  }

  if (clauses.length === 0) return { sql: '', params: [] };
  return { sql: ` AND ${clauses.join(' AND ')}`, params };
}

export function buildOrderSql(
  sort: SortSpec[] | undefined,
  b: Blueprint,
): SqlFragment {
  if (!sort || sort.length === 0) {
    return { sql: 'ORDER BY sort_order ASC, created_at DESC', params: [] };
  }
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const spec of sort) {
    const direction = spec.direction === 'desc' ? 'DESC' : 'ASC';
    if (spec.field in TOP_LEVEL_COLUMN_NAME) {
      parts.push(`${TOP_LEVEL_COLUMN_NAME[spec.field]} ${direction}`);
      continue;
    }
    const field = b.fields.find((f) => f.name === spec.field);
    if (!field) {
      throw new ValidationError([
        { code: 'custom', message: `Unknown sort field: ${spec.field}`, path: ['sort', spec.field] },
      ]);
    }
    parts.push(`json_extract(content, ?) ${direction}`);
    params.push(`$.${spec.field}`);
  }
  return { sql: `ORDER BY ${parts.join(', ')}`, params };
}
