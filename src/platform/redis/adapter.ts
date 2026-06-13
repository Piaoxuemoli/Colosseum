/**
 * Minimal Redis-like surface used by Phase 5-2 Vercel fallback callers.
 *
 * The self-hosted deployment (Docker + ioredis) still uses the full ioredis
 * client via `lib/redis/client.ts`; this abstraction exists so new callers,
 * pub/sub bridges, and future Upstash-only code paths can program against a
 * minimal surface that both backends support.
 *
 * Contract:
 * - `get/set/del` — single-key string ops with optional TTL (seconds).
 * - `publish/subscribe` — simple channel-based messaging. On Upstash (no
 *   native pub/sub on REST) this is emulated by list LPUSH/RPOP polling; the
 *   caller must accept ~0.5-1s latency.
 * - `acquireLock` — best-effort mutex via SET NX EX.
 */
export interface RedisLike {
  get(k: string): Promise<string | null>
  set(k: string, v: string, opts?: { ex?: number }): Promise<void>
  del(k: string): Promise<void>
  publish(ch: string, payload: string): Promise<void>
  /** Returns an unsubscribe function. */
  subscribe(ch: string, onMessage: (payload: string) => void): () => void
  acquireLock(k: string, ttlSec: number): Promise<boolean>
}

let _instance: RedisLike | null = null

/**
 * Env-based factory. Reads `UPSTASH_REDIS_REST_URL` at first call time; if
 * absent, falls back to the ioredis-backed adapter over `REDIS_URL`. The
 * instance is cached for the lifetime of the process.
 *
 * The node-redis and Upstash adapters are dynamically imported so only the
 * one we actually need is evaluated — in particular, the node adapter loads
 * the full typed env schema (`loadEnv`) and should not be pulled in on a
 * Vercel deploy that never uses it.
 *
 * For tests, call `__resetRedisAdapterForTests()` to drop the cache.
 */
export async function getRedisAdapter(): Promise<RedisLike> {
  if (_instance) return _instance
  if (process.env.UPSTASH_REDIS_REST_URL) {
    const { createUpstashAdapter } = await import('./upstash-adapter')
    _instance = createUpstashAdapter()
  } else {
    const { createNodeAdapter } = await import('./node-redis-adapter')
    _instance = createNodeAdapter()
  }
  return _instance
}

/** Test-only helper to drop the cached singleton. */
export function __resetRedisAdapterForTests(): void {
  _instance = null
}
