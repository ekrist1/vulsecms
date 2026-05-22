import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibsqlAdapter } from '@vulse/db';
import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from './bus.js';
import { type VulseModule, loadModules } from './modules.js';

function migrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vulse-mod-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

describe('loadModules', () => {
  it('runs each module migration directory under the module name', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    const bus = createEventBus();
    const dir = migrationsDir({ '001_init.sql': 'CREATE TABLE nl_subs (id INTEGER PRIMARY KEY);' });

    const mod: VulseModule = { name: 'newsletter', migrationsDir: dir };
    await loadModules([mod], { db, bus });

    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = 'nl_subs'",
    );
    expect(tables).toHaveLength(1);
    const applied = await db.query<{ name: string }>('SELECT name FROM _vulse_migrations');
    expect(applied.map((r) => r.name)).toEqual(['newsletter:001_init.sql']);
    await db.close();
  });

  it('wires listeners so module reacts to bus events', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    const bus = createEventBus();
    const seen: string[] = [];
    const mod: VulseModule = {
      name: 'audit',
      listeners: (b) => {
        b.on('user.registered', (p) => {
          seen.push(p.email);
        });
      },
    };
    await loadModules([mod], { db, bus });
    await bus.emit('user.registered', { userId: 'u1', email: 'x@y.z', name: null });
    expect(seen).toEqual(['x@y.z']);
    await db.close();
  });

  it('invokes routes hook with the api router so modules can register endpoints', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    const bus = createEventBus();
    const fakeRouter = { get: vi.fn() };
    const mod: VulseModule = {
      name: 'pings',
      routes: (router) => {
        router.get('/api/pings', () => 'ok');
      },
    };
    await loadModules([mod], { db, bus, router: fakeRouter as never });
    expect(fakeRouter.get).toHaveBeenCalledWith('/api/pings', expect.any(Function));
    await db.close();
  });

  it('throws when two modules share a name', async () => {
    const db = new LibsqlAdapter({ url: ':memory:' });
    const bus = createEventBus();
    await expect(loadModules([{ name: 'dup' }, { name: 'dup' }], { db, bus })).rejects.toThrow(
      /duplicate module name: dup/,
    );
    await db.close();
  });
});
