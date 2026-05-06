import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('GET /api/agents/:id/.well-known/agent-card.json', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
  })

  it('returns a valid A2A agent card for toy agent', async () => {
    const { GET } = await import('@/app/api/agents/[agentId]/.well-known/agent-card.json/route')
    const res = await GET(new Request('http://localhost/x'), { params: Promise.resolve({ agentId: 'toy-poker' }) })
    const card = (await res.json()) as {
      protocolVersion: string
      name: string
      url: string
      skills: { id: string }[]
    }

    expect(res.status).toBe(200)
    expect(card.protocolVersion).toMatch(/^0\.3/)
    expect(card.name).toBe('toy-poker')
    expect(card.url).toContain('/api/agents/toy-poker')
    expect(card.skills.length).toBeGreaterThan(0)
  })

  it('returns 404 for unknown agent id', async () => {
    const { GET } = await import('@/app/api/agents/[agentId]/.well-known/agent-card.json/route')
    const res = await GET(new Request('http://localhost/x'), { params: Promise.resolve({ agentId: 'unknown-xyz' }) })

    expect(res.status).toBe(404)
  })
})
