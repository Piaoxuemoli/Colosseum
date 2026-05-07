import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateSqliteTestDb } from '../lib/db/test-utils'

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

  async expire(_key: string, _seconds: number): Promise<number> {
    return 1
  }

  async publish(channel: string, payload: string): Promise<number> {
    this.published.push({ channel, payload })
    return 1
  }

  async quit(): Promise<'OK'> {
    return 'OK'
  }
}

const fakeRedis = new FakeRedis()

describe('M3: 6 bots end-to-end', () => {
  beforeAll(() => {
    vi.resetModules()
    vi.doMock('@/lib/redis/client', () => ({ redis: fakeRedis }))
    vi.stubEnv('NODE_ENV', 'test')
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-bot-match.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
    // No HTTP server is running inside the test process; the orchestrator
    // still calls its own agent endpoint via fetch. Short-circuit that so
    // we go straight to the bot fallback without waiting for a 5s abort.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (typeof url === 'string' && url.includes('/api/agents/')) {
          return new Response('{"error":"no server in tests"}', {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        }
        throw new Error(`unexpected fetch in bot-match test: ${url}`)
      }),
    )
    migrateSqliteTestDb('./tests/tmp-bot-match.db')
  })

  afterAll(() => {
    // Without this teardown, vi.stubGlobal('fetch', ...) leaks into every
    // subsequent test file when vitest shares a worker, silently making
    // any real-fetch test 503. Must restore before the next file runs.
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('creates match, runs to completion, and persists final ranking/events', async () => {
    const { clearRegistry } = await import('@/lib/core/registry')
    const { registerAllGames } = await import('@/lib/core/register-games')
    clearRegistry()
    registerAllGames()

    const { createProfile } = await import('@/lib/db/queries/profiles')
    const { createAgent } = await import('@/lib/db/queries/agents')
    const profile = await createProfile({
      displayName: 'Bot Profile',
      providerId: 'bot',
      baseUrl: 'http://noop',
      model: 'bot-v1',
    })

    const agentIds: string[] = []
    for (let i = 0; i < 6; i++) {
      const agent = await createAgent({
        displayName: `Bot ${i}`,
        gameType: 'poker',
        kind: 'player',
        profileId: profile.id,
        systemPrompt: 'You are a poker bot.',
      })
      agentIds.push(agent.id)
    }

    const { createAndStartMatch } = await import('@/lib/orchestrator/match-lifecycle')
    const { runMatchToCompletion } = await import('@/lib/orchestrator/game-master')
    const { matchId } = await createAndStartMatch({
      gameType: 'poker',
      agentIds,
      config: { agentTimeoutMs: 5_000, minActionIntervalMs: 0 },
      engineConfig: { smallBlind: 2, bigBlind: 4, startingChips: 200, maxBetsPerStreet: 4 },
    })

    expect(matchId).toMatch(/^match_/)
    await runMatchToCompletion(matchId, { maxTicks: 500, intervalMs: 0 })

    const { findMatchById } = await import('@/lib/db/queries/matches')
    const match = await findMatchById(matchId)
    expect(match?.status).toBe('completed')
    expect(match?.finalRanking).toBeTruthy()

    const { listMatchEvents } = await import('@/lib/db/queries/events')
    const events = await listMatchEvents(matchId)
    expect(events.length).toBeGreaterThan(5)
    expect(events[0].kind).toContain('match-start')
  }, 30_000)
})
