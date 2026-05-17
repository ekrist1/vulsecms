import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SetDefinition } from '../definition.js';
import { createSet, deleteSet, getSet, listSets, updateSet } from '../service.js';

const quoteSet: SetDefinition = {
  handle: 'quote',
  label: 'Quote',
  fields: [{ name: 'q', ui: { kind: 'text' }, optional: false }],
};

describe('sets service', () => {
  let adapter: LibsqlAdapter;
  beforeEach(async () => {
    adapter = new LibsqlAdapter({ url: ':memory:' });
    await adapter.exec('PRAGMA foreign_keys = ON');
    await runMigrations(adapter, MIGRATIONS_DIR);
  });

  it('creates a set', async () => {
    const out = await createSet(adapter, quoteSet);
    expect(out.handle).toBe('quote');
    expect(out.label).toBe('Quote');
    expect(out.fields).toHaveLength(1);
  });

  it('rejects duplicate handle', async () => {
    await createSet(adapter, quoteSet);
    await expect(createSet(adapter, quoteSet)).rejects.toThrow();
  });

  it('lists sets in creation order', async () => {
    await createSet(adapter, quoteSet);
    await createSet(adapter, { ...quoteSet, handle: 'gallery', label: 'Gallery' });
    const all = await listSets(adapter);
    expect(all.map((s) => s.handle)).toEqual(['quote', 'gallery']);
  });

  it('gets a set by handle', async () => {
    await createSet(adapter, quoteSet);
    const got = await getSet(adapter, 'quote');
    expect(got?.label).toBe('Quote');
    expect(await getSet(adapter, 'missing')).toBeNull();
  });

  it('updates label and fields, leaves handle immutable', async () => {
    await createSet(adapter, quoteSet);
    const updated = await updateSet(adapter, 'quote', {
      ...quoteSet,
      label: 'Quote v2',
      fields: [...quoteSet.fields, { name: 'author', ui: { kind: 'text' }, optional: false }],
    });
    expect(updated.label).toBe('Quote v2');
    expect(updated.fields).toHaveLength(2);
  });

  it('throws on update if handle does not match path', async () => {
    await createSet(adapter, quoteSet);
    await expect(updateSet(adapter, 'quote', { ...quoteSet, handle: 'renamed' })).rejects.toThrow(/handle/);
  });

  it('deletes a set', async () => {
    await createSet(adapter, quoteSet);
    await deleteSet(adapter, 'quote');
    expect(await getSet(adapter, 'quote')).toBeNull();
  });
});
