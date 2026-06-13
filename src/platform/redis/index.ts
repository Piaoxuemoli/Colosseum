/**
 * Barrel for the Redis layer.
 *
 * Two surfaces live here side by side:
 * - `redis` / `createRedisClient` (from `./client`) — the full ioredis client
 *   used by existing self-hosted code paths (match state, keyring hash,
 *   pub/sub, locks). Keep using this for ioredis-specific features.
 * - `getRedisAdapter` / `RedisLike` (from `./adapter`) — a minimal backend-
 *   agnostic surface for Phase 5-2 Vercel fallback. Pick this when a new
 *   caller can live with `get/set/del/publish/subscribe/acquireLock` only.
 */
export { keys } from './keys'
export { redis, createRedisClient } from './client'
export type { Redis } from './client'
export {
  getRedisAdapter,
  __resetRedisAdapterForTests,
  type RedisLike,
} from './adapter'
