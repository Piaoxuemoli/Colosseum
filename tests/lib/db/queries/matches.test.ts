import { beforeAll, describe, expect, it, vi } from 'vitest'
import { defaultMatchConfig } from '@/lib/core/types'
import { migrateSqliteTestDb } from '../test-utils'

describe('lib/db/queries/matches', () => {
  beforeAll(() => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-matches.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
    migrateSqliteTestDb('./tests/tmp-matches.db')
  })

  it('creates a match, lists participants, updates status, and finalizes', async () => {
    const { createProfile } = await import('@/lib/db/queries/profiles')
    const { createAgent } = await import('@/lib/db/queries/agents')
    const {
      createMatch,
      finalizeMatchRow,
      findMatchById,
      isAgentParticipant,
      listParticipants,
      updateMatchStatus,
    } = await import('@/lib/db/queries/matches')

    const profile = await createProfile({
      displayName: 'Profile',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    })
    const agentA = await createAgent({
      displayName: 'A',
      gameType: 'poker',
      profileId: profile.id,
      systemPrompt: 'A',
    })
    const agentB = await createAgent({
      displayName: 'B',
      gameType: 'poker',
      profileId: profile.id,
      systemPrompt: 'B',
    })

    const { matchId } = await createMatch({
      gameType: 'poker',
      config: defaultMatchConfig(),
      participants: [
        { agentId: agentA.id, seatIndex: 0, initialData: { chips: 1000 } },
        { agentId: agentB.id, seatIndex: 1, initialData: { chips: 1000 } },
      ],
    })

    expect((await findMatchById(matchId))?.status).toBe('pending')
    expect(await isAgentParticipant(matchId, agentA.id)).toBe(true)
    expect(await isAgentParticipant(matchId, 'agt_missing')).toBe(false)
    expect((await listParticipants(matchId)).length).toBe(2)

    await updateMatchStatus(matchId, 'running')
    expect((await findMatchById(matchId))?.status).toBe('running')

    await finalizeMatchRow({
      matchId,
      winnerFaction: null,
      result: {
        winnerFaction: null,
        ranking: [
          { agentId: agentA.id, rank: 1, score: 1200 },
          { agentId: agentB.id, rank: 2, score: 800 },
        ],
      },
    })
    const finalized = await findMatchById(matchId)
    expect(finalized?.status).toBe('completed')
    expect(finalized?.finalRanking).toBeTruthy()
  })
})
