import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateSqliteTestDb } from '@/tests/lib/db/test-utils'
import { LlmError } from '@/lib/agent/llm-errors'

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

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.[field] ?? null
  }

  async expire(): Promise<number> {
    return 1
  }

  async publish(): Promise<number> {
    return 1
  }
}

const DB = './tests/tmp-agent-stream-api.db'
const fakeRedis = new FakeRedis()
const runDecision = vi.fn()

async function readBody(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let raw = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    raw += decoder.decode(value)
  }
  return raw
}

describe('POST /api/agents/:id/message/stream LLM path', () => {
  let agentId: string
  let matchId: string
  let token: string

  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('@/lib/redis/client', () => ({ redis: fakeRedis }))
    vi.doMock('@/lib/agent/llm-runtime', () => ({ runDecision }))
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
      displayName: 'LLM Profile',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    })

    const agentIds: string[] = []
    for (let i = 0; i < 2; i++) {
      const agent = await createAgent({
        displayName: `LLM${i}`,
        gameType: 'poker',
        profileId: profile.id,
        systemPrompt: 'play legal poker',
      })
      agentIds.push(agent.id)
    }
    agentId = agentIds[0]

    const { createAndStartMatch } = await import('@/lib/orchestrator/match-lifecycle')
    const match = await createAndStartMatch({ gameType: 'poker', agentIds, keyring: { [profile.id]: 'sk-test' } })
    matchId = match.matchId
    token = match.token
  })

  beforeEach(() => {
    runDecision.mockReset()
  })

  it('streams thinking deltas and LLM action when runDecision succeeds', async () => {
    runDecision.mockImplementation(async (input: { userPrompt: string; onThinkingDelta?: (text: string) => void }) => {
      input.onThinkingDelta?.('position looks good')
      const action = input.userPrompt.includes('- fold') ? { type: 'fold' } : { type: 'check' }
      return {
        action,
        thinkingText: 'position looks good',
        rawResponse: `<thinking>position looks good</thinking><action>${JSON.stringify(action)}</action>`,
      }
    })

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
          message: { messageId: 'm', taskId: 't_llm_success', role: 'user', parts: [] },
        }),
      }),
      { params: Promise.resolve({ agentId }) },
    )

    const raw = await readBody(res)
    expect(res.status).toBe(200)
    expect(raw).toContain('position looks good')
    expect(raw).toContain('"action"')
    expect(raw).toContain('"fallback":false')
  })

  it('records an agent error and emits fallback action when runDecision fails', async () => {
    runDecision.mockRejectedValue(new LlmError('parse_fail', 'bad action', { rawResponse: '<action>bad</action>' }))

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
          message: { messageId: 'm', taskId: 't_llm_fallback', role: 'user', parts: [] },
        }),
      }),
      { params: Promise.resolve({ agentId }) },
    )

    const raw = await readBody(res)
    const { listErrorsByMatch } = await import('@/lib/db/queries/errors')
    const errors = await listErrorsByMatch(matchId)

    expect(res.status).toBe(200)
    expect(raw).toContain('"fallback":true')
    expect(errors.some((error) => error.errorCode === 'llm-parse_fail')).toBe(true)
  })
})
