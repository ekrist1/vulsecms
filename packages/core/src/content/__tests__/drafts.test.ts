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

describe('drafts — update', () => {
  it('update({ publish: false }) on a published entry writes draft_content; content unchanged', async () => {
    const { db, content } = await setup();
    const created = await content.create(
      'drafts-posts',
      { title: 'A', slug: 'a' },
      undefined,
      { publish: true },
    );
    const updated = await content.update(
      'drafts-posts',
      created.id,
      { title: 'A-draft', slug: 'a' },
      undefined,
      { publish: false },
    );
    expect(updated.status).toBe('published');
    expect(updated.content).toEqual({ title: 'A', slug: 'a' });
    expect(updated.draftContent).toEqual({ title: 'A-draft', slug: 'a' });
    expect(updated.hasUnpublishedChanges).toBe(true);
    await db.close();
  });

  it('update({ publish: true }) on a published entry with a pending draft promotes', async () => {
    const { db, content } = await setup();
    const created = await content.create(
      'drafts-posts',
      { title: 'B', slug: 'b' },
      undefined,
      { publish: true },
    );
    await content.update(
      'drafts-posts',
      created.id,
      { title: 'B-draft', slug: 'b' },
      undefined,
      { publish: false },
    );
    const promoted = await content.update(
      'drafts-posts',
      created.id,
      { title: 'B-final', slug: 'b' },
      { actor: { userId: 'u9' } },
      { publish: true },
    );
    expect(promoted.status).toBe('published');
    expect(promoted.content).toEqual({ title: 'B-final', slug: 'b' });
    expect(promoted.draftContent).toBeNull();
    expect(promoted.publishedAt).not.toBeNull();
    expect(promoted.publishedBy).toBe('u9');
    await db.close();
  });

  it('update({ publish: true }) on a never-published draft promotes status=published', async () => {
    const { db, content } = await setup();
    const draft = await content.create(
      'drafts-posts',
      { title: 'C', slug: 'c' },
      undefined,
      { publish: false },
    );
    expect(draft.status).toBe('draft');
    const promoted = await content.update(
      'drafts-posts',
      draft.id,
      { title: 'C', slug: 'c' },
      undefined,
      { publish: true },
    );
    expect(promoted.status).toBe('published');
    expect(promoted.content).toEqual({ title: 'C', slug: 'c' });
    expect(promoted.draftContent).toBeNull();
    await db.close();
  });

  it('update({ publish: false }) on a draft entry overwrites draft_content; content stays empty', async () => {
    const { db, content } = await setup();
    const draft = await content.create(
      'drafts-posts',
      { title: 'D', slug: 'd' },
      undefined,
      { publish: false },
    );
    const updated = await content.update(
      'drafts-posts',
      draft.id,
      { title: 'D2', slug: 'd' },
      undefined,
      { publish: false },
    );
    expect(updated.status).toBe('draft');
    expect(updated.content).toEqual({});
    expect(updated.draftContent).toEqual({ title: 'D2', slug: 'd' });
    await db.close();
  });

  it('update() on a drafts-disabled collection behaves exactly as today (regression guard)', async () => {
    const { db, content } = await setup();
    const created = await content.create('posts', { title: 'P', body: [] });
    const updated = await content.update('posts', created.id, { title: 'P2', body: [] });
    expect(updated.status).toBe('published');
    expect(updated.content).toMatchObject({ title: 'P2' });
    expect(updated.draftContent).toBeNull();
    await db.close();
  });
});

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

describe('drafts — publish/unpublish/discard', () => {
  async function makePublishedWithDraft() {
    const { db, content } = await setup();
    const e = await content.create(
      'drafts-posts',
      { title: 'A', slug: 'a' },
      undefined,
      { publish: true },
    );
    await content.update(
      'drafts-posts',
      e.id,
      { title: 'A-draft', slug: 'a' },
      undefined,
      { publish: false },
    );
    return { db, content, id: e.id };
  }

  it('publish() promotes draft_content to content', async () => {
    const { db, content, id } = await makePublishedWithDraft();
    const r = await content.publish('drafts-posts', id, { actor: { userId: 'u9' } });
    expect(r.status).toBe('published');
    expect(r.content).toEqual({ title: 'A-draft', slug: 'a' });
    expect(r.draftContent).toBeNull();
    expect(r.publishedBy).toBe('u9');
    await db.close();
  });

  it('publish() with no pending draft re-publishes current content', async () => {
    const { db, content } = await setup();
    const e = await content.create(
      'drafts-posts',
      { title: 'B', slug: 'b' },
      undefined,
      { publish: true },
    );
    const r = await content.publish('drafts-posts', e.id);
    expect(r.publishedAt).not.toBeNull();
    expect(r.content).toEqual({ title: 'B', slug: 'b' });
    await db.close();
  });

  it('unpublish() moves content to draft_content', async () => {
    const { db, content } = await setup();
    const e = await content.create(
      'drafts-posts',
      { title: 'C', slug: 'c' },
      undefined,
      { publish: true },
    );
    const r = await content.unpublish('drafts-posts', e.id);
    expect(r.status).toBe('draft');
    expect(r.content).toEqual({});
    expect(r.draftContent).toEqual({ title: 'C', slug: 'c' });
    expect(r.publishedAt).toBeNull();
    expect(r.publishedBy).toBeNull();
    await db.close();
  });

  it('unpublish() on a never-published entry throws entry_already_draft', async () => {
    const { db, content } = await setup();
    const e = await content.create(
      'drafts-posts',
      { title: 'D', slug: 'd' },
      undefined,
      { publish: false },
    );
    await expect(content.unpublish('drafts-posts', e.id)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'entry_already_draft' })],
    });
    await db.close();
  });

  it('discardDraft() clears draft_content on a published entry', async () => {
    const { db, content, id } = await makePublishedWithDraft();
    const r = await content.discardDraft('drafts-posts', id);
    expect(r.draftContent).toBeNull();
    expect(r.hasUnpublishedChanges).toBe(false);
    expect(r.content).toEqual({ title: 'A', slug: 'a' });
    await db.close();
  });

  it('discardDraft() on a status=draft entry throws cannot_discard_initial_draft', async () => {
    const { db, content } = await setup();
    const e = await content.create(
      'drafts-posts',
      { title: 'E', slug: 'e' },
      undefined,
      { publish: false },
    );
    await expect(content.discardDraft('drafts-posts', e.id)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'cannot_discard_initial_draft' })],
    });
    await db.close();
  });

  it('discardDraft() on a published entry with no draft throws no_draft_to_discard', async () => {
    const { db, content } = await setup();
    const e = await content.create(
      'drafts-posts',
      { title: 'F', slug: 'f' },
      undefined,
      { publish: true },
    );
    await expect(content.discardDraft('drafts-posts', e.id)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'no_draft_to_discard' })],
    });
    await db.close();
  });

  it('publish/unpublish/discardDraft on a drafts-disabled collection throws drafts_not_enabled', async () => {
    const { db, content } = await setup();
    const e = await content.create('posts', { title: 'P', body: [] });
    await expect(content.publish('posts', e.id)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'drafts_not_enabled' })],
    });
    await expect(content.unpublish('posts', e.id)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'drafts_not_enabled' })],
    });
    await expect(content.discardDraft('posts', e.id)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'drafts_not_enabled' })],
    });
    await db.close();
  });
});
