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

  async quit(): Promise<'OK'> {
    return 'OK'
  }
}

const DB = './tests/tmp-agent-endpoint-api.db'
const fakeRedis = new FakeRedis()

describe('POST /api/agents/:id/message/stream (real)', () => {
  let agentId: string
  let matchId: string
  let token: string

  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('@/lib/redis/client', () => ({ redis: fakeRedis }))
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

    const agentIds: string[] = []
    for (let i = 0; i < 2; i++) {
      const agent = await createAgent({
        displayName: `Bot${i}`,
        gameType: 'poker',
        profileId: profile.id,
        systemPrompt: 'bot',
      })
      agentIds.push(agent.id)
    }
    agentId = agentIds[0]

    const { createAndStartMatch } = await import('@/lib/orchestrator/match-lifecycle')
    const match = await createAndStartMatch({ gameType: 'poker', agentIds })
    matchId = match.matchId
    token = match.token
  })

  it('returns 401 without token', async () => {
    const { POST } = await import('@/app/api/agents/[agentId]/message/stream/route')
    const res = await POST(
      new Request('http://localhost/api/agents/x/message/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: { messageId: 'm', taskId: 't', role: 'user', parts: [] },
        }),
      }),
      { params: Promise.resolve({ agentId }) },
    )
    expect(res.status).toBe(401)
  })

  it('returns stream with bot action when token is valid', async () => {
    const { POST } = await import('@/app/api/agents/[agentId]/message/stream/route')
    const res = await POST(
      new Request('http://localhost/api/agents/x/message/stream', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Match-Id': matchId,
          'X-Match-Token': token,
        },
        body: JSON.stringify({
          message: { messageId: 'm', taskId: 't_heads_up', role: 'user', parts: [] },
        }),
      }),
      { params: Promise.resolve({ agentId }) },
    )

    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let raw = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      raw += decoder.decode(value)
    }
    expect(raw).toContain('"kind":"artifact-update"')
    expect(raw).toContain('"kind":"data"')
    expect(raw).toContain('"action"')
  })
})
