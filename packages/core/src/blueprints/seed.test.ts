import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { describe, expect, it } from 'vitest';
import { seedBlueprintsFromCode } from './seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '__fixtures__');

async function freshDb() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe('seedBlueprintsFromCode', () => {
  it('inserts a row per fixture class', async () => {
    const db = await freshDb();
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    const rows = await db.query<{ handle: string; definition: string }>(
      'SELECT handle, definition FROM collections ORDER BY handle',
    );
    expect(rows.map((r) => r.handle)).toEqual(['authors', 'posts']);
    const posts = JSON.parse(rows[1]!.definition);
    expect(posts.handle).toBe('posts');
    expect(posts.fields.find((f: { name: string }) => f.name === 'title')).toBeDefined();
    await db.close();
  });

  it('is idempotent on second run', async () => {
    const db = await freshDb();
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    const rows = await db.query<{ handle: string }>('SELECT handle FROM collections');
    expect(rows).toHaveLength(2);
    await db.close();
  });

  it('preserves admin-side edits across reseed', async () => {
    const db = await freshDb();
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    await db.exec(
      "UPDATE collections SET definition = json_set(definition, '$.label', 'Articles') WHERE handle = 'posts'",
    );
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    const row = await db.queryOne<{ definition: string }>(
      "SELECT definition FROM collections WHERE handle = 'posts'",
    );
    expect(JSON.parse(row!.definition).label).toBe('Articles');
    await db.close();
  });
});
