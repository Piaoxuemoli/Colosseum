import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateSqliteTestDb } from '@/tests/lib/db/test-utils'

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

const DB = './tests/tmp-matches-api.db'
const fakeRedis = new FakeRedis()

describe('Matches API', () => {
  const agentIds: string[] = []
  let matchId: string

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

  it('POST /api/matches creates match and returns streamUrl', async () => {
    const { POST } = await import('@/app/api/matches/route')
    const res = await POST(
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

    expect(res.status).toBe(201)
    const body = (await res.json()) as { matchId: string; streamUrl: string }
    expect(body.matchId).toMatch(/^match_/)
    expect(body.streamUrl).toContain('/stream')
    matchId = body.matchId
  })

  it('GET /api/matches lists matches', async () => {
    const { GET } = await import('@/app/api/matches/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { matches: Array<{ id: string }> }
    expect(body.matches.some((match) => match.id === matchId)).toBe(true)
  })

  it('GET /api/matches/:id returns detail', async () => {
    const { GET } = await import('@/app/api/matches/[matchId]/route')
    const res = await GET(new Request('http://localhost/api/matches/x'), {
      params: Promise.resolve({ matchId }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { participants: unknown[]; eventCount: number }
    expect(body.participants).toHaveLength(6)
    expect(body.eventCount).toBeGreaterThanOrEqual(1)
  })

  it('POST rejects invalid agent count', async () => {
    const { POST } = await import('@/app/api/matches/route')
    const res = await POST(
      new Request('http://localhost/api/matches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameType: 'poker', agentIds: [agentIds[0]] }),
      }),
    )
    expect(res.status).toBe(400)
  })
})
