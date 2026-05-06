import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'

    vi.doMock('@/lib/db/client', () => ({
      db: {
        select: () => ({
          from: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      },
    }))
    vi.doMock('@/lib/redis/client', () => ({
      redis: {
        ping: () => Promise.resolve('PONG'),
      },
    }))
  })

  it('returns ok=true when db and redis are both reachable', async () => {
    const { GET } = await import('@/app/api/health/route')
    const res = await GET()
    const body = (await res.json()) as {
      ok: boolean
      db: 'ok' | 'error'
      redis: 'ok' | 'error'
    }

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, db: 'ok', redis: 'ok' })
  })
})
