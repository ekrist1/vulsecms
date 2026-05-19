import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { describe, expect, it } from 'vitest';
import { loadBlueprints, reloadBlueprint } from './load.js';
import { seedBlueprintsFromCode } from './seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '__fixtures__');

async function freshDb() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe('loadBlueprints / reloadBlueprint', () => {
  it('loads seeded blueprints with compiled Zod schemas', async () => {
    const db = await freshDb();
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    const map = await loadBlueprints({ adapter: db });
    expect([...map.keys()].sort()).toEqual(['authors', 'drafts-posts', 'posts']);
    expect(map.get('posts')!.schema.safeParse({ title: 'a', body: [] }).success).toBe(true);
    await db.close();
  });

  it('throws when a row has a null definition', async () => {
    const db = await freshDb();
    await db.exec("INSERT INTO collections (handle, blueprint_hash) VALUES ('orphan', 'h')");
    await expect(loadBlueprints({ adapter: db })).rejects.toThrow(/no definition/);
    await db.close();
  });

  it('reloadBlueprint returns a single compiled blueprint', async () => {
    const db = await freshDb();
    await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
    const bp = await reloadBlueprint('posts', { adapter: db });
    expect(bp).not.toBeNull();
    expect(bp!.handle).toBe('posts');
    expect(bp!.hash).toHaveLength(64);
    await db.close();
  });

  it('reloadBlueprint returns null for missing handle', async () => {
    const db = await freshDb();
    expect(await reloadBlueprint('ghost', { adapter: db })).toBeNull();
    await db.close();
  });
});
