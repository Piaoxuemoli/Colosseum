import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateSqliteTestDb } from '@/tests/lib/db/test-utils'

const DB = './tests/tmp-errors-list.db'

describe('GET /api/matches/:id/errors', () => {
  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BASE_URL', 'http://localhost:3000')
    vi.stubEnv('DB_DRIVER', 'sqlite')
    vi.stubEnv('SQLITE_PATH', DB)
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    migrateSqliteTestDb(DB)

    const { recordAgentError } = await import('@/lib/db/queries/errors')
    await recordAgentError({ matchId: 'm1', agentId: 'a1', layer: 'http', errorCode: 'timeout' })
    await recordAgentError({ matchId: 'm1', agentId: 'a2', layer: 'parse', errorCode: 'invalid-json' })
    await recordAgentError({ matchId: 'm2', agentId: 'a3', layer: 'fallback', errorCode: 'other' })
  })

  it('returns errors by match', async () => {
    const { GET } = await import('@/app/api/matches/[matchId]/errors/route')
    const res = await GET(new Request('http://localhost/api/matches/m1/errors'), {
      params: Promise.resolve({ matchId: 'm1' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number; errors: Array<{ matchId: string }> }
    expect(body.count).toBe(2)
    expect(body.errors.every((error) => error.matchId === 'm1')).toBe(true)
  })
})
