import { beforeAll, describe, expect, it, vi } from 'vitest'

describe('GET /api/providers', () => {
  beforeAll(() => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BASE_URL', 'http://localhost:3000')
    vi.stubEnv('DB_DRIVER', 'sqlite')
    vi.stubEnv('SQLITE_PATH', './tests/tmp-providers.db')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
  })

  it('returns provider catalog array', async () => {
    const { GET } = await import('@/app/api/providers/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { providers: Array<{ id: string; displayName: string }> }
    expect(Array.isArray(body.providers)).toBe(true)
    expect(body.providers.length).toBeGreaterThanOrEqual(4)
    expect(body.providers.some((provider) => provider.id === 'openai')).toBe(true)
  })

  it('response is cacheable for 1 hour', async () => {
    const { GET } = await import('@/app/api/providers/route')
    const res = await GET()
    expect(res.headers.get('cache-control')).toContain('max-age')
  })
})
