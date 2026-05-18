import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { compileBlueprint } from '../blueprints/compile.js';
import type { Blueprint } from '../blueprints/types.js';
import { ValidationError } from '../errors.js';
import { createContentService } from './service.js';

async function setup(
  opts: { tree: boolean; maxDepth?: number; singleton?: boolean } = { tree: true },
) {
  const adapter = new LibsqlAdapter({ url: ':memory:' });
  await adapter.exec('PRAGMA foreign_keys = ON');
  await runMigrations(adapter, MIGRATIONS_DIR);
  const def = {
    handle: 'pages',
    label: 'Pages',
    singleton: opts.singleton ?? false,
    tree: opts.tree,
    ...(opts.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {}),
    fields: [{ name: 'title', label: 'Title', ui: { kind: 'text' as const }, optional: false }],
  };
  await adapter.exec(
    `INSERT INTO collections (handle, blueprint_hash, definition, singleton)
     VALUES (?, ?, ?, ?)`,
    [def.handle, 'h', JSON.stringify(def), def.singleton ? 1 : 0],
  );
  const blueprint: Blueprint = compileBlueprint(def);
  const blueprints = new Map<string, Blueprint>([['pages', blueprint]]);
  const content = createContentService(adapter, blueprints);
  return { adapter, content };
}

describe('tree-structured collections', () => {
  describe('create with parentId', () => {
    it('accepts parentId when blueprint.tree=true', async () => {
      const { content } = await setup({ tree: true });
      const root = await content.create('pages', { title: 'About' });
      const child = await content.create('pages', { title: 'Team', parentId: root.id });
      expect(child.parentId).toBe(root.id);
      expect(child.sortOrder).toBe(1);
    });

    it('rejects parentId when blueprint.tree=false', async () => {
      const { content } = await setup({ tree: false });
      const root = await content.create('pages', { title: 'About' });
      await expect(
        content.create('pages', { title: 'Team', parentId: root.id }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects parentId pointing to a missing entry', async () => {
      const { content } = await setup({ tree: true });
      await expect(
        content.create('pages', { title: 'Lonely', parentId: '01-NONEXISTENT' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects parentId from a different collection', async () => {
      const { adapter, content } = await setup({ tree: true });
      const other = {
        handle: 'authors',
        label: 'Authors',
        singleton: false,
        fields: [{ name: 'name', label: 'Name', ui: { kind: 'text' as const }, optional: false }],
      };
      await adapter.exec(
        `INSERT INTO collections (handle, blueprint_hash, definition, singleton)
         VALUES (?, ?, ?, ?)`,
        [other.handle, 'h', JSON.stringify(other), 0],
      );
      await adapter.exec(
        `INSERT INTO entries (id, collection_handle, sort_order, content) VALUES (?, ?, ?, ?)`,
        ['01-AUTHOR-X', 'authors', 1, JSON.stringify({ name: 'Alice' })],
      );
      await expect(
        content.create('pages', { title: 'Bad', parentId: '01-AUTHOR-X' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('enforces maxDepth on create', async () => {
      const { content } = await setup({ tree: true, maxDepth: 2 });
      const a = await content.create('pages', { title: 'A' });
      const b = await content.create('pages', { title: 'B', parentId: a.id });
      await expect(content.create('pages', { title: 'C', parentId: b.id })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects combined singleton + tree at the blueprint layer', async () => {
      // covered by definition.test; sanity-check that the service still works
      // for a normal tree=true collection.
      const { content } = await setup({ tree: true });
      const a = await content.create('pages', { title: 'A' });
      expect(a.parentId).toBeNull();
    });
  });

  describe('list with parentId filter', () => {
    it('returns only root entries with parentId=null', async () => {
      const { content } = await setup({ tree: true });
      const a = await content.create('pages', { title: 'A' });
      await content.create('pages', { title: 'B', parentId: a.id });
      const c = await content.create('pages', { title: 'C' });
      const roots = await content.list('pages', { parentId: null });
      const titles = roots.items.map((e) => (e.content as { title: string }).title).sort();
      expect(titles).toEqual(['A', 'C']);
      // Sort order should be 1, 2 for two roots
      expect(roots.items.find((e) => e.id === a.id)?.sortOrder).toBe(1);
      expect(roots.items.find((e) => e.id === c.id)?.sortOrder).toBe(2);
    });

    it("returns a specific parent's direct children", async () => {
      const { content } = await setup({ tree: true });
      const a = await content.create('pages', { title: 'A' });
      const b1 = await content.create('pages', { title: 'B1', parentId: a.id });
      const b2 = await content.create('pages', { title: 'B2', parentId: a.id });
      await content.create('pages', { title: 'C1', parentId: b1.id });
      const children = await content.list('pages', { parentId: a.id });
      const titles = children.items.map((e) => (e.content as { title: string }).title);
      expect(titles).toEqual(['B1', 'B2']);
      expect(children.items.map((e) => e.sortOrder)).toEqual([1, 2]);
      expect(children.items.find((e) => e.id === b2.id)?.id).toBe(b2.id);
    });

    it('omitting parentId returns all entries regardless of depth', async () => {
      const { content } = await setup({ tree: true });
      const a = await content.create('pages', { title: 'A' });
      await content.create('pages', { title: 'B', parentId: a.id });
      const all = await content.list('pages');
      expect(all.total).toBe(2);
    });
  });

  describe('tree()', () => {
    it('returns a nested structure ordered by sort_order', async () => {
      const { content } = await setup({ tree: true });
      const about = await content.create('pages', { title: 'About' });
      const team = await content.create('pages', { title: 'Team', parentId: about.id });
      await content.create('pages', { title: 'Alice', parentId: team.id });
      await content.create('pages', { title: 'Bob', parentId: team.id });
      await content.create('pages', { title: 'Ethics', parentId: about.id });
      await content.create('pages', { title: 'Careers', parentId: about.id });
      const tree = await content.tree('pages');
      expect(tree).toHaveLength(1);
      expect(tree[0]!.content).toMatchObject({ title: 'About' });
      const aboutChildrenTitles = tree[0]!.children.map(
        (c) => (c.content as { title: string }).title,
      );
      expect(aboutChildrenTitles).toEqual(['Team', 'Ethics', 'Careers']);
      const teamChildren = tree[0]!.children[0]!.children.map(
        (c) => (c.content as { title: string }).title,
      );
      expect(teamChildren).toEqual(['Alice', 'Bob']);
    });

    it('rejects tree() on non-tree collections', async () => {
      const { content } = await setup({ tree: false });
      await expect(content.tree('pages')).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('move()', () => {
    it('reparents and reorders an entry', async () => {
      const { content } = await setup({ tree: true });
      const a = await content.create('pages', { title: 'A' });
      const b = await content.create('pages', { title: 'B' });
      const c = await content.create('pages', { title: 'C', parentId: a.id });

      // Move C from under A to under B.
      const moved = await content.move('pages', c.id, { parentId: b.id });
      expect(moved.parentId).toBe(b.id);
      expect(moved.sortOrder).toBe(1);

      // Move C to specific position 1 under root, pushing A and B down.
      const movedAgain = await content.move('pages', c.id, { parentId: null, sortOrder: 1 });
      expect(movedAgain.parentId).toBeNull();
      expect(movedAgain.sortOrder).toBe(1);
      const roots = await content.list('pages', { parentId: null });
      const titles = roots.items.map((e) => (e.content as { title: string }).title);
      expect(titles).toEqual(['C', 'A', 'B']);
    });

    it('detects cycles and rejects them', async () => {
      const { content } = await setup({ tree: true });
      const a = await content.create('pages', { title: 'A' });
      const b = await content.create('pages', { title: 'B', parentId: a.id });
      const c = await content.create('pages', { title: 'C', parentId: b.id });
      // Trying to move A under C creates A → B → C → A cycle.
      await expect(content.move('pages', a.id, { parentId: c.id })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects moving an entry under itself', async () => {
      const { content } = await setup({ tree: true });
      const a = await content.create('pages', { title: 'A' });
      await expect(content.move('pages', a.id, { parentId: a.id })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('enforces maxDepth on move (including subtree depth)', async () => {
      const { content } = await setup({ tree: true, maxDepth: 3 });
      const a = await content.create('pages', { title: 'A' });
      const b = await content.create('pages', { title: 'B', parentId: a.id });
      const c = await content.create('pages', { title: 'C', parentId: b.id });
      // a/b/c is 3 deep. Moving b (which has child c) under a new root x would
      // still stay within 3, but moving b under another node at depth 2 would push it past.
      const other = await content.create('pages', { title: 'Other' });
      const otherChild = await content.create('pages', { title: 'OtherChild', parentId: other.id });
      // b has subtree depth 1 (c). Moving b under otherChild: depth = 2 + 1 + 1 = 4 > 3.
      await expect(content.move('pages', b.id, { parentId: otherChild.id })).rejects.toBeInstanceOf(
        ValidationError,
      );
      // confirm c didn't move
      const cFresh = await content.get('pages', c.id);
      expect(cFresh?.parentId).toBe(b.id);
    });

    it('rejects move on a non-tree collection', async () => {
      const { content } = await setup({ tree: false });
      const a = await content.create('pages', { title: 'A' });
      await expect(content.move('pages', a.id, { parentId: null })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('repacks the old parent siblings to close gaps', async () => {
      const { content } = await setup({ tree: true });
      const a = await content.create('pages', { title: 'A' });
      const b1 = await content.create('pages', { title: 'B1', parentId: a.id });
      const b2 = await content.create('pages', { title: 'B2', parentId: a.id });
      const b3 = await content.create('pages', { title: 'B3', parentId: a.id });
      // Move B2 to root. Remaining children should be 1, 2 (B1, B3).
      await content.move('pages', b2.id, { parentId: null });
      const children = await content.list('pages', { parentId: a.id });
      expect(children.items.map((e) => e.sortOrder)).toEqual([1, 2]);
      expect(children.items.map((e) => e.id)).toEqual([b1.id, b3.id]);
    });
  });
});
