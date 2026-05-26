// Simple in-memory LRU-style cache with TTL
// Deployed server uses in-memory cache — warm on hit, refetches daily on miss
// For persistent cache across restarts, set CACHE_DB and swap to SQLite

interface CacheEntry {
  value:      unknown;
  fetched_at: number;
  ttl_ms:     number;
}

const store = new Map<string, CacheEntry>();

export const TTL = {
  YIELD_CURVE: 24 * 60 * 60 * 1000,  // 24h
  HISTORICAL:   4 * 60 * 60 * 1000,  // 4h
} as const;

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetched_at > entry.ttl_ms) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function cacheSet(key: string, value: unknown, ttl_ms: number): void {
  store.set(key, { value, fetched_at: Date.now(), ttl_ms });
}

