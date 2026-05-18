import { LibsqlAdapter, MIGRATIONS_DIR, runMigrations } from '@vulse/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedSuperUser } from '../bootstrap.js';

describe('seedSuperUser', () => {
  let adapter: LibsqlAdapter;

  beforeEach(async () => {
    adapter = new LibsqlAdapter({ url: ':memory:' });
    await adapter.exec('PRAGMA foreign_keys = ON');
    await runMigrations(adapter, MIGRATIONS_DIR);
  });

  it('creates a super editor when users table is empty', async () => {
    const out = await seedSuperUser({
      adapter,
      bootstrapEmail: 'admin@example.com',
      bootstrapPassword: 'hunter2hunter2',
      isProd: false,
    });
    expect(out.created).toBe(true);
    expect(out.email).toBe('admin@example.com');
    const row = await adapter.queryOne<{ role: string; is_super: number; email: string }>(
      'SELECT role, is_super, email FROM users WHERE email = ?',
      ['admin@example.com'],
    );
    expect(row).toEqual({ role: 'editor', is_super: 1, email: 'admin@example.com' });
  });

  it('is idempotent', async () => {
    await seedSuperUser({
      adapter,
      bootstrapEmail: 'admin@example.com',
      bootstrapPassword: 'hunter2hunter2',
      isProd: false,
    });
    const out = await seedSuperUser({
      adapter,
      bootstrapEmail: 'admin@example.com',
      bootstrapPassword: 'hunter2hunter2',
      isProd: false,
    });
    expect(out.created).toBe(false);
  });

  it('throws in prod when bootstrap env vars are unset', async () => {
    await expect(
      seedSuperUser({
        adapter,
        bootstrapEmail: undefined,
        bootstrapPassword: undefined,
        isProd: true,
      }),
    ).rejects.toThrow(/VULSE_BOOTSTRAP/);
  });

  it('uses dev fallback when env vars are unset and isProd is false', async () => {
    const out = await seedSuperUser({
      adapter,
      bootstrapEmail: undefined,
      bootstrapPassword: undefined,
      isProd: false,
    });
    expect(out.created).toBe(true);
    expect(out.email).toBe('admin@vulse.local');
    expect(out.generatedPassword).toMatch(/^[A-Za-z0-9]{16}$/);
  });
});
