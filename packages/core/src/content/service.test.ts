import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { describe, expect, it } from 'vitest';
import { loadBlueprints } from '../blueprints/load.js';
import { createBlueprint } from '../blueprints/mutations.js';
import { seedBlueprintsFromCode } from '../blueprints/seed.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { createContentService } from './service.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'blueprints', '__fixtures__');

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db, MIGRATIONS_DIR);
  await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
  const blueprints = await loadBlueprints({ adapter: db });
  const content = createContentService(db, blueprints);
  return { db, blueprints, content };
}

describe('ContentService', () => {
  it('creates an entry with a ULID id and returns canonical shape', async () => {
    const { content, db } = await setup();
    const entry = await content.create('posts', { title: 'Hello', body: [] });
    expect(entry.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(entry.collection).toBe('posts');
    expect(entry.parentId).toBeNull();
    expect(entry.sortOrder).toBe(1);
    expect(entry.status).toBe('published');
    expect(entry.content).toEqual({ title: 'Hello', body: [] });
    await db.close();
  });

  it('rejects invalid input with ValidationError', async () => {
    const { content, db } = await setup();
    await expect(content.create('posts', { title: '', body: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await db.close();
  });

  it('auto-increments sort_order per (collection, parent) scope', async () => {
    const { content, db } = await setup();
    const a = await content.create('posts', { title: 'a', body: [] });
    const b = await content.create('posts', { title: 'b', body: [] });
    expect(b.sortOrder).toBe(a.sortOrder + 1);
    await db.close();
  });

  it('rejects a second entry for singleton collections', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    await db.exec('PRAGMA foreign_keys = ON');
    await runMigrations(db, MIGRATIONS_DIR);
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    await createBlueprint(db, {
      handle: 'home-page',
      label: 'Home page',
      singleton: true,
      fields: [
        { name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false },
      ],
    });
    const blueprints = await loadBlueprints({ adapter: db });
    const content = createContentService(db, blueprints);

    await content.create('home-page', { title: 'Welcome' });
    await expect(content.create('home-page', { title: 'Again' })).rejects.toBeInstanceOf(
      ConflictError,
    );

    await db.close();
  });

  it('list returns entries ordered by sort_order then created_at desc', async () => {
    const { content, db } = await setup();
    await content.create('posts', { title: 'a', body: [] });
    await content.create('posts', { title: 'b', body: [] });
    const list = await content.list('posts');
    expect(list.items.map((e) => e.content.title)).toEqual(['a', 'b']);
    expect(list.total).toBe(2);
    await db.close();
  });

  it('list supports search and pagination', async () => {
    const { content, db } = await setup();
    await content.create('posts', { title: 'Intro to libSQL', body: [] });
    await content.create('posts', { title: 'Hono routes 101', body: [] });
    await content.create('posts', { title: 'Advanced libSQL', body: [] });

    const searched = await content.list('posts', { q: 'libsql' });
    expect(searched.items.map((e) => e.content.title)).toEqual([
      'Intro to libSQL',
      'Advanced libSQL',
    ]);
    expect(searched.total).toBe(2);

    const paged = await content.list('posts', { limit: 1, offset: 1 });
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(3);
    await db.close();
  });

  it('get returns null for missing id', async () => {
    const { content, db } = await setup();
    expect(await content.get('posts', 'nope')).toBeNull();
    await db.close();
  });

  it('update merges and re-validates; preserves unchanged fields', async () => {
    const { content, db } = await setup();
    const created = await content.create('posts', { title: 'a', body: [] });
    const updated = await content.update('posts', created.id, { title: 'b' });
    expect(updated.content).toEqual({ title: 'b', body: [] });
    await db.close();
  });

  it('delete throws NotFoundError for missing id', async () => {
    const { content, db } = await setup();
    await expect(content.delete('posts', 'nope')).rejects.toBeInstanceOf(NotFoundError);
    await db.close();
  });

  it('delete cascades to children', async () => {
    const { content, db } = await setup();
    const parent = await content.create('posts', { title: 'p', body: [] });
    await db.exec(
      "INSERT INTO entries (id, collection_handle, parent_id, content) VALUES ('child', 'posts', ?, '{}')",
      [parent.id],
    );
    await content.delete('posts', parent.id);
    const rows = await db.query('SELECT id FROM entries');
    expect(rows).toEqual([]);
    await db.close();
  });

  it('throws for unknown collection handle', async () => {
    const { content, db } = await setup();
    await expect(content.list('ghost')).rejects.toThrow(/unknown collection/);
    await db.close();
  });
});

describe('list with filters and sort', () => {
  async function seed(content: Awaited<ReturnType<typeof setup>>['content'], rows: Array<Record<string, unknown>>): Promise<string[]> {
    const ids: string[] = [];
    for (const row of rows) {
      const entry = await content.create('posts', { body: [], ...row });
      ids.push(entry.id);
    }
    return ids;
  }

  it('filters by content field equality', async () => {
    const { content, db } = await setup();
    await seed(content, [
      { title: 'A', status: 'published' },
      { title: 'B', status: 'draft' },
      { title: 'C', status: 'published' },
    ]);
    const res = await content.list('posts', { filter: { status: { eq: 'published' } } });
    expect(res.items.map((e) => e.content.title).sort()).toEqual(['A', 'C']);
    await db.close();
  });

  it('filters by IN with multiple values', async () => {
    const { content, db } = await setup();
    await seed(content, [
      { title: 'A', status: 'published' },
      { title: 'B', status: 'draft' },
      { title: 'C', status: 'scheduled' },
    ]);
    const res = await content.list('posts', { filter: { status: { in: ['published', 'scheduled'] } } });
    expect(res.items.map((e) => e.content.title).sort()).toEqual(['A', 'C']);
    await db.close();
  });

  it('filters by date range with gte + lt', async () => {
    const { content, db } = await setup();
    await seed(content, [
      { title: 'A', publishedAt: '2023-06-01' },
      { title: 'B', publishedAt: '2024-03-01' },
      { title: 'C', publishedAt: '2025-02-01' },
    ]);
    const res = await content.list('posts', {
      filter: { publishedAt: { gte: '2024-01-01', lt: '2025-01-01' } },
    });
    expect(res.items.map((e) => e.content.title)).toEqual(['B']);
    await db.close();
  });

  it('filters by neq', async () => {
    const { content, db } = await setup();
    await seed(content, [
      { title: 'A', status: 'published' },
      { title: 'B', status: 'draft' },
    ]);
    const res = await content.list('posts', { filter: { status: { neq: 'draft' } } });
    expect(res.items.map((e) => e.content.title)).toEqual(['A']);
    await db.close();
  });

  it('empty IN returns no items', async () => {
    const { content, db } = await setup();
    await seed(content, [{ title: 'A' }]);
    const res = await content.list('posts', { filter: { status: { in: [] } } });
    expect(res.items).toEqual([]);
    await db.close();
  });

  it('combines q substring and filter with AND', async () => {
    const { content, db } = await setup();
    await seed(content, [
      { title: 'Climate report', status: 'published' },
      { title: 'Climate report v2', status: 'draft' },
      { title: 'Music', status: 'published' },
    ]);
    const res = await content.list('posts', {
      q: 'climate',
      field: 'title',
      filter: { status: { eq: 'published' } },
    });
    expect(res.items.map((e) => e.content.title)).toEqual(['Climate report']);
    await db.close();
  });

  it('sorts by single content field descending', async () => {
    const { content, db } = await setup();
    await seed(content, [
      { title: 'A', publishedAt: '2024-03-01' },
      { title: 'B', publishedAt: '2024-01-01' },
      { title: 'C', publishedAt: '2024-02-01' },
    ]);
    const res = await content.list('posts', {
      sort: [{ field: 'publishedAt', direction: 'desc' }],
    });
    expect(res.items.map((e) => e.content.title)).toEqual(['A', 'C', 'B']);
    await db.close();
  });

  it('sorts by multiple fields in declared order', async () => {
    const { content, db } = await setup();
    await seed(content, [
      { title: 'C', publishedAt: '2024-01-01' },
      { title: 'A', publishedAt: '2024-01-01' },
      { title: 'B', publishedAt: '2024-02-01' },
    ]);
    const res = await content.list('posts', {
      sort: [
        { field: 'publishedAt', direction: 'asc' },
        { field: 'title', direction: 'asc' },
      ],
    });
    expect(res.items.map((e) => e.content.title)).toEqual(['A', 'C', 'B']);
    await db.close();
  });

  it('falls back to default sort when sort omitted', async () => {
    const { content, db } = await setup();
    await seed(content, [{ title: 'A' }, { title: 'B' }]);
    const res = await content.list('posts');
    // Default: sort_order ASC, created_at DESC. Insertion order monotonic on sort_order.
    expect(res.items.map((e) => e.content.title)).toEqual(['A', 'B']);
    await db.close();
  });

  it('rejects unknown filter field with ValidationError', async () => {
    const { content, db } = await setup();
    await seed(content, [{ title: 'A' }]);
    await expect(
      content.list('posts', { filter: { totally_unknown: { eq: 'x' } } }),
    ).rejects.toThrow();
    await db.close();
  });

  it('rejects unknown sort field with ValidationError', async () => {
    const { content, db } = await setup();
    await seed(content, [{ title: 'A' }]);
    await expect(
      content.list('posts', { sort: [{ field: 'nope', direction: 'asc' }] }),
    ).rejects.toThrow();
    await db.close();
  });
});
