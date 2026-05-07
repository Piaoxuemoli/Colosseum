import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateSqliteTestDb } from '@/tests/lib/db/test-utils'

const DB = './tests/tmp-agent-card-api.db'

describe('GET /api/agents/:id/.well-known/agent-card.json', () => {
  let agentId: string

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BASE_URL', 'http://localhost:3000')
    vi.stubEnv('DB_DRIVER', 'sqlite')
    vi.stubEnv('SQLITE_PATH', DB)
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    migrateSqliteTestDb(DB)

    const { createProfile } = await import('@/lib/db/queries/profiles')
    const { createAgent } = await import('@/lib/db/queries/agents')
    const profile = await createProfile({
      displayName: 'P',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    })
    const agent = await createAgent({
      displayName: 'Alice',
      gameType: 'poker',
      profileId: profile.id,
      systemPrompt: 'Aggressive player.',
    })
    agentId = agent.id
  })

  it('returns card for real agent from DB', async () => {
    const { GET } = await import('@/app/api/agents/[agentId]/.well-known/agent-card.json/route')
    const res = await GET(new Request('http://localhost/api/agents/x/.well-known/agent-card.json'), {
      params: Promise.resolve({ agentId }),
    })

    expect(res.status).toBe(200)
    const card = (await res.json()) as { name: string; url: string; skills: Array<{ tags: string[] }> }
    expect(card.name).toBe('Alice')
    expect(card.url).toContain(agentId)
    expect(card.skills[0].tags).toContain('poker')
  })

  it('legacy toy-poker still works', async () => {
    const { GET } = await import('@/app/api/agents/[agentId]/.well-known/agent-card.json/route')
    const res = await GET(new Request('http://localhost/api/agents/toy-poker/.well-known/agent-card.json'), {
      params: Promise.resolve({ agentId: 'toy-poker' }),
    })

    expect(res.status).toBe(200)
  })
})
