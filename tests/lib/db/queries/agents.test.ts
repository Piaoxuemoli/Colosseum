import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateSqliteTestDb } from '../test-utils'

describe('lib/db/queries/agents + profiles', () => {
  beforeAll(() => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-agents.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
    migrateSqliteTestDb('./tests/tmp-agents.db')
  })

  it('create + findById + list round trip', async () => {
    const { createProfile, findProfileById, listProfiles } = await import('@/lib/db/queries/profiles')
    const { createAgent, findAgentById, listAgents } = await import('@/lib/db/queries/agents')

    const profile = await createProfile({
      displayName: 'DeepSeek Test',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    })
    const agent = await createAgent({
      displayName: 'Bot A',
      gameType: 'poker',
      profileId: profile.id,
      systemPrompt: 'Play tight poker.',
      avatarEmoji: 'A',
    })

    expect((await findProfileById(profile.id))?.displayName).toBe('DeepSeek Test')
    expect((await findAgentById(agent.id))?.displayName).toBe('Bot A')
    expect((await listProfiles()).length).toBe(1)
    expect((await listAgents({ gameType: 'poker', kind: 'player' })).map((row) => row.id)).toEqual([agent.id])
  })
})
