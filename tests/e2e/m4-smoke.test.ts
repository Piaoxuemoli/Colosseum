import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateSqliteTestDb } from '@/tests/lib/db/test-utils'

class FakeRedis {
  private readonly values = new Map<string, string>()
  private readonly hashes = new Map<string, Record<string, string>>()
  readonly published: Array<{ channel: string; payload: string }> = []

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

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.[field] ?? null
  }

  async expire(): Promise<number> {
    return 1
  }

  async publish(channel: string, payload: string): Promise<number> {
    this.published.push({ channel, payload })
    return 1
  }
}

const DB = './tests/tmp-m4-smoke.db'
const fakeRedis = new FakeRedis()

describe('M4 smoke (mock LLM)', () => {
  beforeAll(() => {
    vi.resetModules()
    vi.doMock('@/lib/redis/client', () => ({ redis: fakeRedis }))
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BASE_URL', 'http://localhost:3000')
    vi.stubEnv('DB_DRIVER', 'sqlite')
    vi.stubEnv('SQLITE_PATH', DB)
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('M4_MOCK_LLM', '1')
    migrateSqliteTestDb(DB)
  })

  it('routes a 6-agent match through mocked LLM endpoints to settlement', async () => {
    const { POST } = await import('@/app/api/agents/[agentId]/message/stream/route')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString()
        const match = url.match(/\/api\/agents\/([^/]+)\/message\/stream/)
        if (!match) return new Response(null, { status: 404 })
        return POST(new Request(url, init), { params: Promise.resolve({ agentId: match[1] }) })
      }),
    )

    const { clearRegistry } = await import('@/lib/core/registry')
    const { registerAllGames } = await import('@/lib/core/register-games')
    clearRegistry()
    registerAllGames()

    const { createProfile } = await import('@/lib/db/queries/profiles')
    const { createAgent } = await import('@/lib/db/queries/agents')
    const profile = await createProfile({
      displayName: 'Mock LLM',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    })

    const agentIds: string[] = []
    for (let i = 0; i < 6; i++) {
      const agent = await createAgent({
        displayName: `Mock LLM ${i}`,
        gameType: 'poker',
        kind: 'player',
        profileId: profile.id,
        systemPrompt: 'Return legal poker actions.',
      })
      agentIds.push(agent.id)
    }

    const { createAndStartMatch } = await import('@/lib/orchestrator/match-lifecycle')
    const { runMatchToCompletion } = await import('@/lib/orchestrator/game-master')
    const { matchId } = await createAndStartMatch({
      gameType: 'poker',
      agentIds,
      config: { agentTimeoutMs: 5_000, minActionIntervalMs: 0 },
      engineConfig: { smallBlind: 2, bigBlind: 4, startingChips: 60, maxBetsPerStreet: 1 },
      keyring: { [profile.id]: 'sk-mock' },
    })

    await runMatchToCompletion(matchId, { maxTicks: 500, intervalMs: 0 })

    const { findMatchById } = await import('@/lib/db/queries/matches')
    const completed = await findMatchById(matchId)
    const ranking = completed?.finalRanking?.ranking as Array<{ score: number }> | undefined

    expect(completed?.status).toBe('completed')
    expect(ranking).toHaveLength(6)
    expect(ranking?.reduce((sum, item) => sum + item.score, 0)).toBe(6 * 60)
    expect(fakeRedis.published.some((event) => event.payload.includes('thinking-delta'))).toBe(true)
  }, 30_000)
})
