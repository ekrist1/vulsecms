import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../errors.js';
import type { BlueprintDefinition, BlueprintDefinitionWithRenames } from './definition.js';
import { createBlueprint, deleteBlueprint, updateBlueprint } from './mutations.js';
import { seedBlueprintsFromCode } from './seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '__fixtures__');

async function setup() {
  const db = new LibsqlAdapter({ url: ':memory:' });
  await db.exec('PRAGMA foreign_keys = ON');
  await runMigrations(db, MIGRATIONS_DIR);
  await seedBlueprintsFromCode({ adapter: db, dir: fixturesDir });
  return db;
}

const minimal: BlueprintDefinition = {
  handle: 'pages',
  label: 'Pages',
  singleton: false,
  fields: [{ name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false }],
};

describe('createBlueprint', () => {
  it('inserts a new blueprint and returns the persisted definition', async () => {
    const db = await setup();
    const out = await createBlueprint(db, minimal);
    expect(out.handle).toBe('pages');
    const row = await db.queryOne<{ definition: string }>(
      "SELECT definition FROM collections WHERE handle = 'pages'",
    );
    expect(JSON.parse(row!.definition).handle).toBe('pages');
    await db.close();
  });

  it('rejects a duplicate handle', async () => {
    const db = await setup();
    await expect(createBlueprint(db, { ...minimal, handle: 'posts' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await db.close();
  });

  it('rejects an invalid handle', async () => {
    const db = await setup();
    await expect(createBlueprint(db, { ...minimal, handle: '1nvalid' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await db.close();
  });

  it('rejects empty fields', async () => {
    const db = await setup();
    await expect(createBlueprint(db, { ...minimal, fields: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await db.close();
  });

  it('rejects duplicate field names', async () => {
    const db = await setup();
    await expect(
      createBlueprint(db, {
        ...minimal,
        fields: [
          { name: 'x', ui: { kind: 'text' }, optional: false },
          { name: 'x', ui: { kind: 'text' }, optional: false },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await db.close();
  });

  it('rejects a relationship whose target does not exist', async () => {
    const db = await setup();
    await expect(
      createBlueprint(db, {
        ...minimal,
        fields: [{ name: 'parent', ui: { kind: 'relationship', to: 'ghosts' }, optional: false }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await db.close();
  });

  it('rejects duplicate replicator set names and nested relationship targets that do not exist', async () => {
    const db = await setup();
    await expect(
      createBlueprint(db, {
        ...minimal,
        fields: [
          {
            name: 'content',
            label: 'Content',
            ui: {
              kind: 'replicator',
              sets: [
                {
                  name: 'hero',
                  fields: [{ name: 'title', ui: { kind: 'text' }, optional: false }],
                },
                {
                  name: 'hero',
                  fields: [
                    { name: 'author', ui: { kind: 'relationship', to: 'ghosts' }, optional: false },
                  ],
                },
              ],
            },
            optional: false,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await db.close();
  });
});

describe('updateBlueprint', () => {
  it('replaces the definition and recomputes the hash', async () => {
    const db = await setup();
    const next: BlueprintDefinitionWithRenames = {
      handle: 'posts',
      label: 'Articles',
      singleton: false,
      fields: [
        {
          name: 'title',
          label: 'Title',
          ui: { kind: 'text' },
          optional: false,
          validation: { min: 1 },
        },
        { name: 'body', label: 'Body', ui: { kind: 'blocks' }, optional: false },
      ],
    };
    await updateBlueprint(db, 'posts', next);
    const row = await db.queryOne<{ definition: string; blueprint_hash: string }>(
      "SELECT definition, blueprint_hash FROM collections WHERE handle = 'posts'",
    );
    expect(JSON.parse(row!.definition).label).toBe('Articles');
    expect(row!.blueprint_hash).toHaveLength(64);
    await db.close();
  });

  it('preserves tree, maxDepth, and drafts flags through PATCH', async () => {
    const db = await setup();
    await updateBlueprint(db, 'posts', {
      handle: 'posts',
      label: 'Posts',
      singleton: false,
      tree: true,
      maxDepth: 3,
      drafts: true,
      fields: [
        { name: 'title', label: 'Title', ui: { kind: 'text' }, optional: false },
        { name: 'body', label: 'Body', ui: { kind: 'blocks' }, optional: false },
      ],
    });
    const row = await db.queryOne<{ definition: string }>(
      "SELECT definition FROM collections WHERE handle = 'posts'",
    );
    const def = JSON.parse(row!.definition);
    expect(def.tree).toBe(true);
    expect(def.maxDepth).toBe(3);
    expect(def.drafts).toBe(true);
    await db.close();
  });

  it('renames a field and rewrites entries.content JSON keys', async () => {
    const db = await setup();
    await db.exec(
      'INSERT INTO entries (id, collection_handle, content) VALUES (\'e1\', \'posts\', \'{"title":"Hello","body":[]}\')',
    );

    await updateBlueprint(db, 'posts', {
      handle: 'posts',
      label: 'Posts',
      singleton: false,
      fields: [
        {
          name: 'headline',
          previousName: 'title',
          label: 'Headline',
          ui: { kind: 'text' },
          optional: false,
        },
        { name: 'body', label: 'Body', ui: { kind: 'blocks' }, optional: false },
      ],
    });

    const row = await db.queryOne<{ content: string }>(
      "SELECT content FROM entries WHERE id = 'e1'",
    );
    const parsed = JSON.parse(row!.content);
    expect(parsed).toEqual({ headline: 'Hello', body: [] });
    await db.close();
  });

  it('leaves orphan data when a field is removed', async () => {
    const db = await setup();
    await db.exec(
      'INSERT INTO entries (id, collection_handle, content) VALUES (\'e1\', \'posts\', \'{"title":"Hello","body":[]}\')',
    );
    await updateBlueprint(db, 'posts', {
      handle: 'posts',
      label: 'Posts',
      singleton: false,
      fields: [{ name: 'body', label: 'Body', ui: { kind: 'blocks' }, optional: false }],
    });
    const row = await db.queryOne<{ content: string }>(
      "SELECT content FROM entries WHERE id = 'e1'",
    );
    expect(JSON.parse(row!.content)).toEqual({ title: 'Hello', body: [] });
    await db.close();
  });

  it('rejects previousName that did not exist in the prior definition', async () => {
    const db = await setup();
    await expect(
      updateBlueprint(db, 'posts', {
        handle: 'posts',
        label: 'Posts',
        singleton: false,
        fields: [
          {
            name: 'x',
            previousName: 'never_existed',
            ui: { kind: 'text' },
            optional: false,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await db.close();
  });

  it('throws NotFoundError for unknown handle', async () => {
    const db = await setup();
    await expect(
      updateBlueprint(db, 'ghost', { ...minimal, handle: 'ghost' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await db.close();
  });
});

describe('deleteBlueprint', () => {
  it('removes the row and cascades to entries', async () => {
    const db = await setup();
    await db.exec(
      "INSERT INTO entries (id, collection_handle, content) VALUES ('e1', 'posts', '{}')",
    );
    await deleteBlueprint(db, 'posts');
    expect(await db.queryOne("SELECT handle FROM collections WHERE handle = 'posts'")).toBeNull();
    expect(await db.query("SELECT id FROM entries WHERE collection_handle = 'posts'")).toEqual([]);
    await db.close();
  });

  it('throws NotFoundError for unknown handle', async () => {
    const db = await setup();
    await expect(deleteBlueprint(db, 'ghost')).rejects.toBeInstanceOf(NotFoundError);
    await db.close();
  });
});
