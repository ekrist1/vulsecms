import { type Client, type Config, type InValue, createClient } from '@libsql/client';
import type { DatabaseAdapter, Row } from './adapter.js';

export class LibsqlAdapter implements DatabaseAdapter {
  private client: Client;

  constructor(config: Config) {
    this.client = createClient(config);
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.client.execute({ sql, args: params as InValue[] });
  }

  async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.client.execute({ sql, args: params as InValue[] });
    return result.rows.map((r) => ({ ...r }) as T);
  }

  async queryOne<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    await this.client.execute('BEGIN');
    const txAdapter: DatabaseAdapter = {
      exec: async (sql, params = []) => {
        await this.client.execute({ sql, args: params as InValue[] });
      },
      query: async <U = Row>(sql: string, params: unknown[] = []): Promise<U[]> => {
        const r = await this.client.execute({ sql, args: params as InValue[] });
        return r.rows.map((row) => ({ ...row }) as U);
      },
      queryOne: async <U = Row>(sql: string, params: unknown[] = []): Promise<U | null> => {
        const r = await this.client.execute({ sql, args: params as InValue[] });
        const first = r.rows[0];
        return first ? ({ ...first } as U) : null;
      },
      transaction: () => {
        throw new Error('nested transactions are not supported');
      },
      close: async () => {}, // no-op: connection lifetime belongs to the outer adapter
    };
    try {
      const out = await fn(txAdapter);
      await this.client.execute('COMMIT');
      return out;
    } catch (err) {
      try {
        await this.client.execute('ROLLBACK');
      } catch {
        // ROLLBACK failed; connection is likely dead — surface the original error
      }
      throw err;
    }
  }

  async close(): Promise<void> {
    this.client.close();
  }
}
