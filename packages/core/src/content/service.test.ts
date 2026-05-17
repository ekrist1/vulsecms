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
