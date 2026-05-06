import { beforeAll, describe, expect, it, vi } from 'vitest'
import { newEventId } from '@/lib/core/ids'
import { defaultMatchConfig } from '@/lib/core/types'
import { migrateSqliteTestDb } from '../test-utils'

describe('lib/db/queries events/errors/memory', () => {
  let matchId: string
  let agentA: string
  let agentB: string

  beforeAll(async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-events-memory.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
    migrateSqliteTestDb('./tests/tmp-events-memory.db')

    const { createProfile } = await import('@/lib/db/queries/profiles')
    const { createAgent } = await import('@/lib/db/queries/agents')
    const { createMatch } = await import('@/lib/db/queries/matches')

    const profile = await createProfile({
      displayName: 'Profile',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    })
    agentA = (await createAgent({ displayName: 'A', gameType: 'poker', profileId: profile.id, systemPrompt: 'A' })).id
    agentB = (await createAgent({ displayName: 'B', gameType: 'poker', profileId: profile.id, systemPrompt: 'B' })).id
    matchId = (await createMatch({
      gameType: 'poker',
      config: defaultMatchConfig(),
      participants: [
        { agentId: agentA, seatIndex: 0 },
        { agentId: agentB, seatIndex: 1 },
      ],
    })).matchId
  })

  it('appends and lists match events in seq order', async () => {
    const { appendEvents, listMatchEvents, nextSeq } = await import('@/lib/db/queries/events')

    expect(await nextSeq(matchId)).toBe(1)
    await appendEvents([
      {
        id: newEventId(),
        matchId,
        gameType: 'poker',
        seq: 2,
        occurredAt: '2026-05-06T00:00:02Z',
        kind: 'poker/bet',
        actorAgentId: agentB,
        payload: { amount: 20 },
        visibility: 'public',
        restrictedTo: null,
      },
      {
        id: newEventId(),
        matchId,
        gameType: 'poker',
        seq: 1,
        occurredAt: '2026-05-06T00:00:01Z',
        kind: 'poker/deal-hole',
        actorAgentId: null,
        payload: { to: agentA },
        visibility: 'private',
        restrictedTo: [agentA],
      },
    ])

    const events = await listMatchEvents(matchId)
    expect(events.map((event) => event.seq)).toEqual([1, 2])
    expect(await nextSeq(matchId)).toBe(3)
    expect((await listMatchEvents(matchId, { visibility: 'private' })).length).toBe(1)
  })

  it('records agent errors without leaking huge raw responses', async () => {
    const { recordAgentError } = await import('@/lib/db/queries/errors')
    await expect(
      recordAgentError({
        matchId,
        agentId: agentA,
        layer: 'parse',
        errorCode: 'bad_json',
        rawResponse: 'x'.repeat(3000),
        recoveryAction: { action: 'fold' },
      }),
    ).resolves.toBeUndefined()
  })

  it('round trips working, episodic, and semantic memory', async () => {
    const {
      deleteWorkingMemory,
      insertEpisodic,
      listEpisodic,
      loadAllSemanticForObserver,
      loadSemantic,
      loadWorkingMemory,
      saveWorkingMemory,
      upsertSemantic,
    } = await import('@/lib/db/queries/memory')

    await saveWorkingMemory({
      observerAgentId: agentA,
      matchId,
      gameType: 'poker',
      stateJson: { suspicion: { [agentB]: 0.2 } },
    })
    expect(await loadWorkingMemory(agentA, matchId)).toEqual({ suspicion: { [agentB]: 0.2 } })
    await saveWorkingMemory({
      observerAgentId: agentA,
      matchId,
      gameType: 'poker',
      stateJson: { suspicion: { [agentB]: 0.4 } },
    })
    expect(await loadWorkingMemory(agentA, matchId)).toEqual({ suspicion: { [agentB]: 0.4 } })

    await insertEpisodic({
      observerAgentId: agentA,
      targetAgentId: agentB,
      matchId,
      gameType: 'poker',
      entryJson: { note: 'bluffed river' },
      tags: ['bluff'],
    })
    expect((await listEpisodic({ observerAgentId: agentA, targetAgentId: agentB, gameType: 'poker' }))[0].tags).toEqual([
      'bluff',
    ])

    await upsertSemantic({
      observerAgentId: agentA,
      targetAgentId: agentB,
      gameType: 'poker',
      profileJson: { style: 'loose' },
      gamesObserved: 1,
    })
    await upsertSemantic({
      observerAgentId: agentA,
      targetAgentId: agentB,
      gameType: 'poker',
      profileJson: { style: 'tight' },
      gamesObserved: 2,
    })
    expect(await loadSemantic({ observerAgentId: agentA, targetAgentId: agentB, gameType: 'poker' })).toEqual({
      profileJson: { style: 'tight' },
      gamesObserved: 2,
    })
    expect((await loadAllSemanticForObserver({ observerAgentId: agentA, gameType: 'poker' })).get(agentB)).toBeTruthy()

    await deleteWorkingMemory(agentA, matchId)
    expect(await loadWorkingMemory(agentA, matchId)).toBeNull()
  })
})
