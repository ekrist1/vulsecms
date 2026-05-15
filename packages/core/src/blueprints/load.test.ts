import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { describe, expect, it } from 'vitest';
import { loadBlueprints } from './load.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '__fixtures__');

async function freshDb() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await runMigrations(db, MIGRATIONS_DIR);
  return db;
}

describe('loadBlueprints', () => {
  it('loads class-based blueprints and exposes field meta', async () => {
    const db = await freshDb();
    const map = await loadBlueprints(fixturesDir, { adapter: db });

    expect([...map.keys()].sort()).toEqual(['authors', 'posts']);

    const posts = map.get('posts')!;
    expect(posts.label).toBe('Posts');
    expect(posts.fields.find((f) => f.name === 'title')?.ui.kind).toBe('text');
    expect(posts.fields.find((f) => f.name === 'body')?.ui.kind).toBe('blocks');

    await db.close();
  });

  it('upserts a collections row per blueprint', async () => {
    const db = await freshDb();
    await loadBlueprints(fixturesDir, { adapter: db });
    const rows = await db.query<{ handle: string; blueprint_hash: string }>(
      'SELECT handle, blueprint_hash FROM collections ORDER BY handle',
    );
    expect(rows.map((r) => r.handle)).toEqual(['authors', 'posts']);
    expect(rows.every((r) => r.blueprint_hash.length === 64)).toBe(true);
    await db.close();
  });

  it('hash is stable across reloads of the same blueprint', async () => {
    const db = await freshDb();
    const a = await loadBlueprints(fixturesDir, { adapter: db });
    const b = await loadBlueprints(fixturesDir, { adapter: db });
    expect(a.get('posts')!.hash).toBe(b.get('posts')!.hash);
    await db.close();
  });
});
