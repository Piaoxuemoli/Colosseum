import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateSqliteTestDb } from '../lib/db/test-utils'

class FakeRedis {
  private readonly values = new Map<string, string>()
  private readonly hashes = new Map<string, Record<string, string>>()

  async set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    if (args.includes('NX') && this.values.has(key)) return null
    this.values.set(key, value)
    return 'OK'
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0
    for (const key of keys) {
      if (this.values.delete(key)) deleted += 1
      if (this.hashes.delete(key)) deleted += 1
    }
    return deleted
  }

  async hset(key: string, values: Record<string, string>): Promise<number> {
    this.hashes.set(key, { ...(this.hashes.get(key) ?? {}), ...values })
    return Object.keys(values).length
  }

  async expire(): Promise<number> {
    return 1
  }

  async publish(): Promise<number> {
    return 1
  }
}

const DB = './tests/tmp-api-match-e2e.db'
const fakeRedis = new FakeRedis()

describe('M4: API end-to-end match', () => {
  const agentIds: string[] = []

  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('@/lib/redis/client', () => ({ redis: fakeRedis }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 202 })))
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BASE_URL', 'http://localhost:3000')
    vi.stubEnv('DB_DRIVER', 'sqlite')
    vi.stubEnv('SQLITE_PATH', DB)
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    migrateSqliteTestDb(DB)

    const { clearRegistry } = await import('@/lib/core/registry')
    const { registerAllGames } = await import('@/lib/core/register-games')
    clearRegistry()
    registerAllGames()

    const { createProfile } = await import('@/lib/db/queries/profiles')
    const { createAgent } = await import('@/lib/db/queries/agents')
    const profile = await createProfile({
      displayName: 'P',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    })
    for (let i = 0; i < 6; i++) {
      const agent = await createAgent({
        displayName: `Bot${i}`,
        gameType: 'poker',
        profileId: profile.id,
        systemPrompt: 'bot',
      })
      agentIds.push(agent.id)
    }
  })

  it('creates via API, ticks to completion, and reads events via API', async () => {
    const { POST: createPost } = await import('@/app/api/matches/route')
    const createRes = await createPost(
      new Request('http://localhost/api/matches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gameType: 'poker',
          agentIds,
          engineConfig: { smallBlind: 2, bigBlind: 4, startingChips: 200, maxBetsPerStreet: 4 },
        }),
      }),
    )
    expect(createRes.status).toBe(201)
    const { matchId } = (await createRes.json()) as { matchId: string }

    const { POST: tickPost } = await import('@/app/api/matches/[matchId]/tick/route')
    for (let i = 0; i < 500; i++) {
      const res = await tickPost(new Request('http://localhost/api/matches/x/tick', { method: 'POST' }), {
        params: Promise.resolve({ matchId }),
      })
      const body = (await res.json()) as { done: boolean }
      if (body.done) break
    }

    const { GET: detailGet } = await import('@/app/api/matches/[matchId]/route')
    const detailRes = await detailGet(new Request('http://localhost/api/matches/x'), {
      params: Promise.resolve({ matchId }),
    })
    const detail = (await detailRes.json()) as {
      match: { status: string; finalRanking: unknown }
      eventCount: number
    }

    expect(detail.match.status).toBe('completed')
    expect(detail.eventCount).toBeGreaterThan(5)
    expect(detail.match.finalRanking).toBeDefined()
  }, 60_000)
})
