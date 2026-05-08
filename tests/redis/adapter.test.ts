import { describe, expect, it, vi, beforeEach } from 'vitest'
import { __resetRedisAdapterForTests, getRedisAdapter } from '@/lib/redis/adapter'

// Mock @upstash/redis so we never hit the network.
const hoistedSpies = vi.hoisted(() => {
  return {
    get: vi.fn<(key: string) => Promise<string | null>>(),
    set: vi.fn<(key: string, value: string, opts?: unknown) => Promise<unknown>>(),
    del: vi.fn<(key: string) => Promise<number>>(),
    lpush: vi.fn<(key: string, value: string) => Promise<number>>(),
    expire: vi.fn<(key: string, ttl: number) => Promise<number>>(),
    rpop: vi.fn<(key: string) => Promise<string | null>>(),
  }
})

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {
      return hoistedSpies
    }
  },
}))

describe('RedisLike adapter factory', () => {
  beforeEach(() => {
    __resetRedisAdapterForTests()
    hoistedSpies.get.mockReset()
    hoistedSpies.set.mockReset()
    hoistedSpies.del.mockReset()
    hoistedSpies.lpush.mockReset()
    hoistedSpies.expire.mockReset()
    hoistedSpies.rpop.mockReset()
  })

  it('picks the Upstash adapter when UPSTASH_REDIS_REST_URL is set', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-xxx')

    hoistedSpies.get.mockResolvedValueOnce('hello')
    const adapter = await getRedisAdapter()
    const v = await adapter.get('k')
    expect(v).toBe('hello')
    expect(hoistedSpies.get).toHaveBeenCalledWith('k')

    vi.unstubAllEnvs()
  })

  it('Upstash adapter: set with ex routes to { ex } option', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-xxx')

    const adapter = await getRedisAdapter()
    await adapter.set('k', 'v', { ex: 30 })
    expect(hoistedSpies.set).toHaveBeenCalledWith('k', 'v', { ex: 30 })

    vi.unstubAllEnvs()
  })

  it('Upstash adapter: publish uses LPUSH with a channel-scoped key and sets TTL', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-xxx')

    const adapter = await getRedisAdapter()
    await adapter.publish('match:abc', 'payload-1')
    expect(hoistedSpies.lpush).toHaveBeenCalledWith('ch:match:abc', 'payload-1')
    expect(hoistedSpies.expire).toHaveBeenCalledWith('ch:match:abc', 300)

    vi.unstubAllEnvs()
  })

  it('Upstash adapter: acquireLock returns true iff SET NX EX returned OK', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-xxx')

    hoistedSpies.set.mockResolvedValueOnce('OK')
    hoistedSpies.set.mockResolvedValueOnce(null)

    const adapter = await getRedisAdapter()
    expect(await adapter.acquireLock('lock:x', 30)).toBe(true)
    expect(await adapter.acquireLock('lock:x', 30)).toBe(false)

    vi.unstubAllEnvs()
  })
})
