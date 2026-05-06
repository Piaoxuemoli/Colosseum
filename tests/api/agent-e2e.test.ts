import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('M2: A2A end-to-end (toy client to toy server)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
  })

  it('client gets fold decision from toy-poker', async () => {
    const { POST } = await import('@/app/api/agents/[agentId]/message/stream/route')
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const rawUrl = String(url)
      const match = rawUrl.match(/\/api\/agents\/([^/]+)\/message\/stream/)
      if (!match) throw new Error(`unexpected url: ${rawUrl}`)
      const req = new Request(rawUrl, init)
      return POST(req, { params: Promise.resolve({ agentId: match[1] }) })
    })

    const { requestAgentDecisionToy } = await import('@/lib/a2a-core/client')
    const thoughts: string[] = []
    const decision = await requestAgentDecisionToy<{ action: string; reasoning: string }>({
      baseUrl: 'http://localhost:3000',
      agentId: 'toy-poker',
      taskId: 'task_e2e_1',
      message: {
        role: 'user',
        parts: [{ kind: 'data', data: { kind: 'poker/decide', state: {} } }],
      },
      matchToken: 'e2e-tok',
      onThinking: (delta) => thoughts.push(delta),
    })

    expect(decision.action).toBe('fold')
    expect(decision.reasoning).toBe('toy')
    expect(thoughts.length).toBeGreaterThan(0)
    expect(thoughts.join('')).toContain('评估')
  })
})
