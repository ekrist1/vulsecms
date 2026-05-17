import { describe, expect, it } from 'vitest';
import { databaseConfigFromEnv, describeConfig } from './config.js';

describe('databaseConfigFromEnv', () => {
  it('defaults to a local file URL when no env vars are set', () => {
    expect(databaseConfigFromEnv({})).toEqual({ url: 'file:./dev.db' });
  });

  it('reads the libsql Turso URL + auth token', () => {
    const config = databaseConfigFromEnv({
      VULSE_DB_URL: 'libsql://my-db.turso.io',
      VULSE_DB_AUTH_TOKEN: 'tk_secret',
    });
    expect(config).toEqual({ url: 'libsql://my-db.turso.io', authToken: 'tk_secret' });
  });

  it('parses embedded-replica config', () => {
    const config = databaseConfigFromEnv({
      VULSE_DB_URL: 'file:./local-replica.db',
      VULSE_DB_AUTH_TOKEN: 'tk',
      VULSE_DB_SYNC_URL: 'libsql://my-db.turso.io',
      VULSE_DB_SYNC_INTERVAL: '60',
    });
    expect(config.syncUrl).toBe('libsql://my-db.turso.io');
    expect(config.syncInterval).toBe(60);
  });

  it('ignores an invalid sync interval', () => {
    const config = databaseConfigFromEnv({
      VULSE_DB_URL: 'file:./x.db',
      VULSE_DB_SYNC_URL: 'libsql://x',
      VULSE_DB_SYNC_INTERVAL: 'nope',
    });
    expect(config.syncInterval).toBeUndefined();
  });
});

describe('describeConfig', () => {
  it('describes a local file config', () => {
    const s = describeConfig({ url: 'file:./dev.db' });
    expect(s.scheme).toBe('file');
    expect(s.remote).toBe(false);
    expect(s.embeddedReplica).toBe(false);
  });

  it('describes a remote Turso config', () => {
    const s = describeConfig({ url: 'libsql://my-db.turso.io', authToken: 'x' });
    expect(s.scheme).toBe('libsql');
    expect(s.host).toBe('my-db.turso.io');
    expect(s.remote).toBe(true);
  });

  it('describes embedded replicas', () => {
    const s = describeConfig({
      url: 'file:./replica.db',
      authToken: 'x',
      syncUrl: 'libsql://my-db.turso.io',
    });
    expect(s.embeddedReplica).toBe(true);
    expect(s.syncUrlHost).toBe('my-db.turso.io');
  });

  it('marks the in-memory URL', () => {
    expect(describeConfig({ url: ':memory:' }).scheme).toBe('memory');
  });
});
