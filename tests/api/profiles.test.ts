import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateSqliteTestDb } from '@/tests/lib/db/test-utils'

const DB = './tests/tmp-profiles-api.db'

describe('Profiles API', () => {
  let profileId: string

  beforeAll(() => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BASE_URL', 'http://localhost:3000')
    vi.stubEnv('DB_DRIVER', 'sqlite')
    vi.stubEnv('SQLITE_PATH', DB)
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    migrateSqliteTestDb(DB)
  })

  it('POST /api/profiles creates profile', async () => {
    const { POST } = await import('@/app/api/profiles/route')
    const req = new Request('http://localhost/api/profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Test',
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; displayName: string }
    expect(body.id).toMatch(/^prof_/)
    expect(body.displayName).toBe('Test')
    profileId = body.id
  })

  it('GET /api/profiles returns list', async () => {
    const { GET } = await import('@/app/api/profiles/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { profiles: Array<{ id: string }> }
    expect(body.profiles.some((profile) => profile.id === profileId)).toBe(true)
  })

  it('POST /api/profiles rejects invalid body', async () => {
    const { POST } = await import('@/app/api/profiles/route')
    const req = new Request('http://localhost/api/profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: '' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('DELETE /api/profiles/:id removes profile', async () => {
    const { DELETE } = await import('@/app/api/profiles/[profileId]/route')
    const res = await DELETE(new Request('http://localhost/api/profiles/x', { method: 'DELETE' }), {
      params: Promise.resolve({ profileId }),
    })
    expect(res.status).toBe(204)
  })
})
