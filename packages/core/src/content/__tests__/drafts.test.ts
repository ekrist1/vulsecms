import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { describe, expect, it } from 'vitest';
import { loadBlueprints } from '../../blueprints/load.js';
import { seedBlueprintsFromCode } from '../../blueprints/seed.js';
import { createContentService } from '../service.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', 'blueprints', '__fixtures__');

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db, MIGRATIONS_DIR);
  await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
  const blueprints = await loadBlueprints({ adapter: db });
  const content = createContentService(db, blueprints);
  return { db, content };
}

describe('drafts — create', () => {
  it('create({ publish: false }) on drafts-enabled collection writes draft_content and leaves content empty', async () => {
    const { db, content } = await setup();
    const entry = await content.create(
      'drafts-posts',
      { title: 'X', slug: 'x' },
      { actor: { userId: 'u1' } },
      { publish: false },
    );
    expect(entry.status).toBe('draft');
    expect(entry.content).toEqual({});
    expect(entry.draftContent).toEqual({ title: 'X', slug: 'x' });
    expect(entry.hasUnpublishedChanges).toBe(true);
    expect(entry.publishedAt).toBeNull();
    expect(entry.publishedBy).toBeNull();
    await db.close();
  });

  it('create({ publish: true }) writes straight to content and sets published metadata', async () => {
    const { db, content } = await setup();
    const entry = await content.create(
      'drafts-posts',
      { title: 'Y', slug: 'y' },
      { actor: { userId: 'u1' } },
      { publish: true },
    );
    expect(entry.status).toBe('published');
    expect(entry.content).toEqual({ title: 'Y', slug: 'y' });
    expect(entry.draftContent).toBeNull();
    expect(entry.publishedAt).not.toBeNull();
    expect(entry.publishedBy).toBe('u1');
    await db.close();
  });

  it('create() with no opts on drafts-enabled collection publishes (default behaviour, matches today)', async () => {
    const { db, content } = await setup();
    const entry = await content.create('drafts-posts', { title: 'Z', slug: 'z' });
    expect(entry.status).toBe('published');
    expect(entry.content).toEqual({ title: 'Z', slug: 'z' });
    expect(entry.draftContent).toBeNull();
    await db.close();
  });

  it('create on drafts-disabled collection ignores publish:false (regression guard)', async () => {
    const { db, content } = await setup();
    const entry = await content.create(
      'posts',
      { title: 'P', body: [] },
      undefined,
      { publish: false },
    );
    expect(entry.status).toBe('published');
    expect(entry.content).toMatchObject({ title: 'P' });
    expect(entry.draftContent).toBeNull();
    await db.close();
  });
});
