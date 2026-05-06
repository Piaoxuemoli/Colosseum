import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('lib/redis/client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('creates an ioredis client with the configured url', async () => {
    const { createRedisClient } = await import('@/lib/redis/client')
    const client = createRedisClient({ lazyConnect: true })

    expect(client.options.host).toBe('localhost')
    expect(client.options.port).toBe(6379)
    expect(client.options.lazyConnect).toBe(true)
    expect(client.options.maxRetriesPerRequest).toBe(3)

    client.disconnect()
  })

  it('allows overriding the redis url for tests or isolated workers', async () => {
    const { createRedisClient } = await import('@/lib/redis/client')
    const client = createRedisClient({ url: 'redis://127.0.0.1:6380', lazyConnect: true })

    expect(client.options.host).toBe('127.0.0.1')
    expect(client.options.port).toBe(6380)

    client.disconnect()
  })
})
