const inflight = new Map<string, Promise<unknown>>();

export async function dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = factory().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
