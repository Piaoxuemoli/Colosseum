import { Redis } from '@upstash/redis'
import type { RedisLike } from './adapter'

/**
 * Upstash REST-backed `RedisLike`. Used when `UPSTASH_REDIS_REST_URL` is set
 * (Vercel + Supabase fallback). Upstash free tier has no native pub/sub on
 * REST, so we emulate publish/subscribe with list LPUSH (producer) and
 * RPOP polling (consumer, ~800ms loop).
 */
export function createUpstashAdapter(): RedisLike {
  const r = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })

  return {
    async get(k) {
      const v = await r.get<string>(k)
      return v ?? null
    },

    async set(k, v, opts) {
      if (opts?.ex) await r.set(k, v, { ex: opts.ex })
      else await r.set(k, v)
    },

    async del(k) {
      await r.del(k)
    },

    // Emulated pub/sub. Keep the list short-lived so abandoned subscribers
    // don't pile up unbounded payloads.
    async publish(ch, payload) {
      const listKey = `ch:${ch}`
      await r.lpush(listKey, payload)
      await r.expire(listKey, 300)
    },

    subscribe(ch, onMessage) {
      const listKey = `ch:${ch}`
      let stopped = false
      ;(async () => {
        while (!stopped) {
          try {
            const msg = await r.rpop<string>(listKey)
            if (msg) {
              onMessage(msg)
            } else {
              await new Promise((resolve) => setTimeout(resolve, 800))
            }
          } catch {
            // Back off on transient errors so we don't hot-loop the REST API.
            await new Promise((resolve) => setTimeout(resolve, 2000))
          }
        }
      })()
      return () => {
        stopped = true
      }
    },

    async acquireLock(k, ttlSec) {
      // Upstash SDK returns "OK" | null.
      const res = await r.set(k, '1', { nx: true, ex: ttlSec })
      return res === 'OK'
    },
  }
}
