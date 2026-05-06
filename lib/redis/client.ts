import Redis from 'ioredis'
import { loadEnv } from '@/lib/env'

export type RedisClientOptions = {
  url?: string
  lazyConnect?: boolean
}

/**
 * ioredis singleton. L3 business code should use this instance for match state,
 * tokens, keyrings, working memory, pub/sub, and match locks.
 *
 * Key space:
 * - match:<id>:state / :token / :keyring / :memory:<agentId>:working
 * - channel:match:<id>
 * - lock:match:<id>
 */
export function createRedisClient(options: RedisClientOptions = {}): Redis {
  const env = loadEnv()
  return new Redis(options.url ?? env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: options.lazyConnect ?? true,
  })
}

export const redis: Redis = createRedisClient()

export type { Redis } from 'ioredis'
