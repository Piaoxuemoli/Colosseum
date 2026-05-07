import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateSqliteTestDb } from '@/tests/lib/db/test-utils'

const DB = './tests/tmp-agents-api.db'

describe('Agents API', () => {
  let profileId: string
  let agentId: string

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BASE_URL', 'http://localhost:3000')
    vi.stubEnv('DB_DRIVER', 'sqlite')
    vi.stubEnv('SQLITE_PATH', DB)
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    migrateSqliteTestDb(DB)

    const { createProfile } = await import('@/lib/db/queries/profiles')
    const profile = await createProfile({
      displayName: 'P',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    })
    profileId = profile.id
  })

  it('POST /api/agents creates agent', async () => {
    const { POST } = await import('@/app/api/agents/route')
    const req = new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: 'TestBot',
        gameType: 'poker',
        profileId,
        systemPrompt: 'You are a poker bot.',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; kind: string }
    expect(body.id).toMatch(/^agt_/)
    expect(body.kind).toBe('player')
    agentId = body.id
  })

  it('POST rejects invalid gameType', async () => {
    const { POST } = await import('@/app/api/agents/route')
    const req = new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: 'X',
        gameType: 'bogus',
        profileId,
        systemPrompt: 'x',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('POST rejects moderator kind for poker', async () => {
    const { POST } = await import('@/app/api/agents/route')
    const req = new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: 'X',
        gameType: 'poker',
        kind: 'moderator',
        profileId,
        systemPrompt: 'x',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('GET /api/agents?gameType=poker returns filter', async () => {
    const { GET } = await import('@/app/api/agents/route')
    const req = new Request('http://localhost/api/agents?gameType=poker')
    const res = await GET(req)
    const body = (await res.json()) as { agents: Array<{ gameType: string }> }
    expect(body.agents.length).toBeGreaterThan(0)
    expect(body.agents.every((agent) => agent.gameType === 'poker')).toBe(true)
  })

  it('GET and DELETE /api/agents/:id work', async () => {
    const route = await import('@/app/api/agents/[agentId]/route')
    const getRes = await route.GET(new Request('http://localhost/api/agents/x'), {
      params: Promise.resolve({ agentId }),
    })
    expect(getRes.status).toBe(200)

    const deleteRes = await route.DELETE(new Request('http://localhost/api/agents/x', { method: 'DELETE' }), {
      params: Promise.resolve({ agentId }),
    })
    expect(deleteRes.status).toBe(204)
  })
})
