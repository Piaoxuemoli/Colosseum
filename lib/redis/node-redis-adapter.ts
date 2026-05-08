import Redis from 'ioredis'
import { loadEnv } from '@/lib/env'
import type { RedisLike } from './adapter'

/**
 * ioredis-backed `RedisLike`. Used by self-hosted deploys (Docker + Redis).
 *
 * Internally opens two connections: one for commands and one for pub/sub,
 * because ioredis forbids issuing regular commands on a connection that is
 * currently in subscribe mode.
 */
export function createNodeAdapter(): RedisLike {
  const env = loadEnv()
  const cmd = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 })

  return {
    async get(k) {
      return await cmd.get(k)
    },

    async set(k, v, opts) {
      if (opts?.ex) await cmd.set(k, v, 'EX', opts.ex)
      else await cmd.set(k, v)
    },

    async del(k) {
      await cmd.del(k)
    },

    async publish(ch, payload) {
      await cmd.publish(ch, payload)
    },

    subscribe(ch, onMessage) {
      const sub = new Redis(env.REDIS_URL, { lazyConnect: true })
      let stopped = false
      sub.subscribe(ch).catch(() => {
        // If subscribe fails (e.g. server unreachable), the caller can still
        // unsubscribe via the returned function; swallow to avoid crashing
        // the whole process.
      })
      sub.on('message', (receivedChannel: string, message: string) => {
        if (stopped) return
        if (receivedChannel !== ch) return
        onMessage(message)
      })
      return () => {
        stopped = true
        try {
          sub.disconnect()
        } catch {
          // Already disconnected.
        }
      }
    },

    async acquireLock(k, ttlSec) {
      // ioredis returns "OK" | null for SET ... NX EX.
      const res = await cmd.set(k, '1', 'EX', ttlSec, 'NX')
      return res === 'OK'
    },
  }
}
