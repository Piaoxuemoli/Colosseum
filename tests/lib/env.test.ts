import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('lib/env', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
  })

  it('loads valid env', async () => {
    const { loadEnv } = await import('@/lib/env')
    const env = loadEnv()
    expect(env.BASE_URL).toBe('http://localhost:3000')
    expect(env.DB_DRIVER).toBe('sqlite')
  })

  it('throws on invalid DB_DRIVER', async () => {
    process.env.DB_DRIVER = 'bogus'
    const { loadEnv } = await import('@/lib/env')
    expect(() => loadEnv()).toThrow(/DB_DRIVER/)
  })
})
