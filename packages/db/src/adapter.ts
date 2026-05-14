export type Row = Record<string, unknown>;

export interface DatabaseAdapter {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
