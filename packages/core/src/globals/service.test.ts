import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { describe, expect, it } from 'vitest';
import { loadGlobalSets } from './load.js';
import { createGlobalService } from './service.js';

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db, MIGRATIONS_DIR);
  const globals = createGlobalService(db, await loadGlobalSets({ adapter: db }));
  return { db, globals };
}

describe('global service', () => {
  it('creates global sets and stores validated content', async () => {
    const { db, globals } = await setup();
    await globals.createSet({
      handle: 'site',
      label: 'Site',
      fields: [
        { name: 'siteName', ui: { kind: 'text' }, optional: false },
        { name: 'announcement', ui: { kind: 'textarea' }, optional: true },
      ],
    });

    const saved = await globals.updateValue('site', {
      siteName: 'Vulse',
      announcement: 'Hello',
    });

    expect(saved.content).toEqual({ siteName: 'Vulse', announcement: 'Hello' });
    await expect(globals.updateValue('site', { siteName: 123 })).rejects.toMatchObject({
      name: 'ValidationError',
    });
    await db.close();
  });

  it('returns public values keyed by handle', async () => {
    const { db, globals } = await setup();
    await globals.createSet({
      handle: 'footer',
      label: 'Footer',
      fields: [{ name: 'copyright', ui: { kind: 'text' }, optional: false }],
    });
    await globals.updateValue('footer', { copyright: '2026 Vulse' });

    expect(await globals.publicValues()).toEqual({
      footer: { copyright: '2026 Vulse' },
    });
    await db.close();
  });

  it('updates definitions and deletes values via cascade', async () => {
    const { db, globals } = await setup();
    await globals.createSet({
      handle: 'social',
      label: 'Social',
      fields: [{ name: 'mastodon', ui: { kind: 'text' }, optional: true }],
    });
    await globals.updateSet('social', {
      handle: 'social',
      label: 'Social links',
      fields: [{ name: 'bluesky', ui: { kind: 'text' }, optional: true }],
    });
    expect(await globals.getSet('social')).toMatchObject({ label: 'Social links' });

    await globals.deleteSet('social');
    expect(await globals.listSets()).toEqual([]);
    const rows = await db.query<{ handle: string }>('SELECT handle FROM global_values');
    expect(rows).toEqual([]);
    await db.close();
  });
});
