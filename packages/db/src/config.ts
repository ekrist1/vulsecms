import type { Config } from '@libsql/client';

const DEFAULT_LOCAL_URL = 'file:./dev.db';

/**
 * Build a libsql client config from environment variables.
 *
 * Recognised vars:
 *   VULSE_DB_URL              connection URL (file:..., libsql://..., http(s)://...)
 *   VULSE_DB_AUTH_TOKEN       bearer token for Turso / remote libsql servers
 *   VULSE_DB_SYNC_URL         remote URL when using an embedded replica
 *   VULSE_DB_SYNC_INTERVAL    seconds between sync pulls (embedded replica)
 *   VULSE_DB_ENCRYPTION_KEY   at-rest encryption key for the local file
 */
export function databaseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.VULSE_DB_URL?.trim() || DEFAULT_LOCAL_URL;
  const config: Config = { url };
  if (env.VULSE_DB_AUTH_TOKEN) config.authToken = env.VULSE_DB_AUTH_TOKEN;
  if (env.VULSE_DB_SYNC_URL) config.syncUrl = env.VULSE_DB_SYNC_URL;
  if (env.VULSE_DB_SYNC_INTERVAL) {
    const n = Number(env.VULSE_DB_SYNC_INTERVAL);
    if (Number.isFinite(n) && n > 0) config.syncInterval = n;
  }
  if (env.VULSE_DB_ENCRYPTION_KEY) config.encryptionKey = env.VULSE_DB_ENCRYPTION_KEY;
  return config;
}

/**
 * Describe a database config for display (admin status panel, logs).
 * Never includes secrets.
 */
export interface DatabaseConfigSummary {
  driver: 'libsql';
  scheme: 'file' | 'libsql' | 'http' | 'https' | 'ws' | 'wss' | 'memory' | 'unknown';
  host: string | null;
  syncUrlHost: string | null;
  embeddedReplica: boolean;
  remote: boolean;
  encrypted: boolean;
}

export function describeConfig(config: Config): DatabaseConfigSummary {
  const url = config.url;
  let scheme: DatabaseConfigSummary['scheme'] = 'unknown';
  let host: string | null = null;

  if (url === ':memory:' || url === 'file::memory:') {
    scheme = 'memory';
  } else if (url.startsWith('file:')) {
    scheme = 'file';
    host = url.slice('file:'.length).replace(/^\/+/, '') || null;
  } else {
    try {
      const parsed = new URL(url);
      const proto = parsed.protocol.replace(':', '');
      if (
        proto === 'libsql' ||
        proto === 'http' ||
        proto === 'https' ||
        proto === 'ws' ||
        proto === 'wss'
      ) {
        scheme = proto;
      }
      host = parsed.host || null;
    } catch {
      // ignore — leaves scheme as 'unknown'
    }
  }

  let syncUrlHost: string | null = null;
  if (config.syncUrl) {
    try {
      syncUrlHost = new URL(config.syncUrl).host || null;
    } catch {
      syncUrlHost = null;
    }
  }

  return {
    driver: 'libsql',
    scheme,
    host,
    syncUrlHost,
    embeddedReplica: Boolean(config.syncUrl),
    remote:
      scheme === 'libsql' ||
      scheme === 'http' ||
      scheme === 'https' ||
      scheme === 'ws' ||
      scheme === 'wss',
    encrypted: Boolean(config.encryptionKey),
  };
}
