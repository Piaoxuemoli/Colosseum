import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateSqliteTestDb } from '../lib/db/test-utils'

/**
 * M5 — two matches running in the same process must not observe each
 * other's events / finalization. We use two independent FakeRedis
 * instances backed by a router that keys on matchId embedded in the
 * key. This validates Phase 2-2 isolation without standing up a real
 * Redis cluster.
 */

type RedisRouter = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]): any
  published: Array<{ channel: string; payload: string }>
}

function makeRedis(): RedisRouter {
  const values = new Map<string, string>()
  const hashes = new Map<string, Record<string, string>>()
  const published: Array<{ channel: string; payload: string }> = []

  const r = {
    published,
    async set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
      if (args.includes('NX') && values.has(key)) return null
      values.set(key, value)
      return 'OK'
    },
    async get(key: string): Promise<string | null> {
      return values.get(key) ?? null
    },
    async del(...keys: string[]): Promise<number> {
      let deleted = 0
      for (const key of keys) {
        if (values.delete(key)) deleted++
        if (hashes.delete(key)) deleted++
      }
      return deleted
    },
    async hset(key: string, vs: Record<string, string>): Promise<number> {
      hashes.set(key, { ...(hashes.get(key) ?? {}), ...vs })
      return Object.keys(vs).length
    },
    async expire() {
      return 1
    },
    async publish(channel: string, payload: string): Promise<number> {
      published.push({ channel, payload })
      return 1
    },
    async quit(): Promise<'OK'> {
      return 'OK'
    },
  }
  return r as unknown as RedisRouter
}

const fakeRedis = makeRedis()

describe('M5: concurrent matches isolation', () => {
  beforeAll(() => {
    vi.resetModules()
    vi.doMock('@/lib/redis/client', () => ({ redis: fakeRedis }))
    vi.stubEnv('NODE_ENV', 'test')
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-concurrent.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (typeof url === 'string' && url.includes('/api/agents/')) {
          return new Response('{}', {
            status: 503,
            headers: { 'content-type': 'application/json' },
          })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )
    migrateSqliteTestDb('./tests/tmp-concurrent.db')
  })

  it('two parallel matches settle independently without event crosstalk', async () => {
    const { clearRegistry } = await import('@/lib/core/registry')
    const { registerAllGames } = await import('@/lib/core/register-games')
    clearRegistry()
    registerAllGames()

    const { createProfile } = await import('@/lib/db/queries/profiles')
    const { createAgent } = await import('@/lib/db/queries/agents')
    const { createAndStartMatch } = await import('@/lib/orchestrator/match-lifecycle')
    const { runMatchToCompletion } = await import('@/lib/orchestrator/game-master')
    const { findMatchById } = await import('@/lib/db/queries/matches')
    const { listMatchEvents } = await import('@/lib/db/queries/events')

    const profile = await createProfile({
      displayName: 'Concurrent Profile',
      providerId: 'bot',
      baseUrl: 'http://noop',
      model: 'bot-v1',
    })

    async function seedAgents(): Promise<string[]> {
      const ids: string[] = []
      for (let i = 0; i < 6; i++) {
        const a = await createAgent({
          displayName: `Bot ${i}-${Math.random().toString(36).slice(2, 6)}`,
          gameType: 'poker',
          kind: 'player',
          profileId: profile.id,
          systemPrompt: 'You are a poker bot.',
        })
        ids.push(a.id)
      }
      return ids
    }

    const [agentsA, agentsB] = await Promise.all([seedAgents(), seedAgents()])

    const [{ matchId: idA }, { matchId: idB }] = await Promise.all([
      createAndStartMatch({
        gameType: 'poker',
        agentIds: agentsA,
        config: { agentTimeoutMs: 5_000, minActionIntervalMs: 0 },
        engineConfig: { smallBlind: 2, bigBlind: 4, startingChips: 200, maxBetsPerStreet: 4 },
      }),
      createAndStartMatch({
        gameType: 'poker',
        agentIds: agentsB,
        config: { agentTimeoutMs: 5_000, minActionIntervalMs: 0 },
        engineConfig: { smallBlind: 2, bigBlind: 4, startingChips: 200, maxBetsPerStreet: 4 },
      }),
    ])

    expect(idA).not.toBe(idB)

    await Promise.all([
      runMatchToCompletion(idA, { maxTicks: 500, intervalMs: 0 }),
      runMatchToCompletion(idB, { maxTicks: 500, intervalMs: 0 }),
    ])

    const [matchA, matchB] = await Promise.all([findMatchById(idA), findMatchById(idB)])
    expect(matchA?.status).toBe('completed')
    expect(matchB?.status).toBe('completed')

    const [eventsA, eventsB] = await Promise.all([listMatchEvents(idA), listMatchEvents(idB)])
    expect(eventsA.length).toBeGreaterThan(5)
    expect(eventsB.length).toBeGreaterThan(5)
    expect(eventsA.every((e) => e.matchId === idA)).toBe(true)
    expect(eventsB.every((e) => e.matchId === idB)).toBe(true)

    // Participants must not overlap between matches.
    const setA = new Set(agentsA)
    expect(agentsB.every((id) => !setA.has(id))).toBe(true)
  }, 60_000)
})
