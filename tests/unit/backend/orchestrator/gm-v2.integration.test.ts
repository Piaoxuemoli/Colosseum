/**
 * GM v2 驱动循环集成测试（spec §9.1）：mock Redis + DB，两游戏经
 * applyDefaultAction 兜底路径（agent token 缺失）跑到终局。
 * 断言：terminal classify、事件信封（kind/audience→visibility/restrictedTo）、
 * 引擎 seq 单调无碰撞、扑克印象信号、stop/force-end 生命周期。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eventsOf, resetStore, seedAgent, store } from './gm-v2-harness'
import type { StoredAgentError, StoredEpisodic, StoredEvent } from './gm-v2-harness'

vi.mock('@/platform/redis/client', async () => {
  const helpers = await import('./gm-v2-harness')
  return { redis: helpers.store.redis }
})

vi.mock('@/platform/db/client', () => ({ db: {} }))

vi.mock('@/platform/db/queries/events', async () => {
  const helpers = await import('./gm-v2-harness')
  return {
    appendEvents: async (rows: StoredEvent[]) => {
      helpers.store.events.push(...rows)
    },
    appendEvent: async (row: StoredEvent) => {
      helpers.store.events.push(row)
    },
    nextSeq: async (matchId: string) =>
      helpers.store.events
        .filter((event) => event.matchId === matchId)
        .reduce((max, event) => Math.max(max, event.seq), 0) + 1,
    listMatchEvents: async (matchId: string) =>
      helpers.store.events
        .filter((event) => event.matchId === matchId)
        .sort((a, b) => a.seq - b.seq)
        .map((event) => ({ ...event, occurredAt: String(event.occurredAt) })),
  }
})

vi.mock('@/platform/db/queries/matches', async () => {
  const helpers = await import('./gm-v2-harness')
  return {
    createMatch: async (input: {
      gameType: string
      config: Record<string, unknown>
      participants: Array<{ agentId: string; seatIndex: number; initialData?: Record<string, unknown> }>
    }) => {
      const matchId = helpers.nextMatchId()
      helpers.store.matches.push({
        id: matchId,
        gameType: input.gameType,
        status: 'pending',
        config: input.config,
        startedAt: new Date(),
        completedAt: null,
        winnerFaction: null,
        finalRanking: null,
        stats: null,
      })
      for (const participant of input.participants) {
        helpers.store.participants.push({
          matchId,
          agentId: participant.agentId,
          seatIndex: participant.seatIndex,
          initialData: participant.initialData ?? null,
        })
      }
      return { matchId }
    },
    findMatchById: async (id: string) => helpers.store.matches.find((match) => match.id === id),
    listParticipants: async (matchId: string) =>
      helpers.store.participants.filter((participant) => participant.matchId === matchId),
    updateMatchStatus: async (id: string, status: string) => {
      const match = helpers.store.matches.find((row) => row.id === id)
      if (match) match.status = status
    },
    finalizeMatchRow: async (input: { matchId: string; winnerFaction: string | null; result: Record<string, unknown> }) => {
      const match = helpers.store.matches.find((row) => row.id === input.matchId)
      if (match) {
        match.status = 'completed'
        match.completedAt = new Date()
        match.winnerFaction = input.winnerFaction
        match.finalRanking = input.result
      }
      helpers.store.finalized.push({
        matchId: input.matchId,
        winnerFaction: input.winnerFaction,
        result: input.result,
      })
    },
    isAgentParticipant: async () => true,
  }
})

vi.mock('@/platform/db/queries/agents', async () => {
  const helpers = await import('./gm-v2-harness')
  return { findAgentById: async (id: string) => helpers.store.agents.get(id) }
})

vi.mock('@/platform/db/queries/memory', async () => {
  const helpers = await import('./gm-v2-harness')
  return {
    insertEpisodic: async (input: StoredEpisodic) => {
      helpers.store.episodic.push(input)
    },
    listEpisodic: async (input: { observerAgentId: string; targetAgentId: string | null; gameType: string }) =>
      helpers.store.episodic
        .filter(
          (entry) =>
            entry.observerAgentId === input.observerAgentId &&
            entry.targetAgentId === input.targetAgentId &&
            entry.gameType === input.gameType,
        )
        .slice(-5)
        .reverse()
        .map((entry) => ({ entryJson: entry.entryJson, tags: entry.tags ?? null, createdAt: new Date() })),
    loadSemantic: async (input: { observerAgentId: string; targetAgentId: string; gameType: string }) =>
      helpers.store.semantic.get(`${input.observerAgentId}:${input.targetAgentId}`) ?? null,
    upsertSemantic: async (input: {
      observerAgentId: string
      targetAgentId: string
      profileJson: Record<string, unknown>
      gamesObserved: number
    }) => {
      helpers.store.semantic.set(`${input.observerAgentId}:${input.targetAgentId}`, {
        profileJson: input.profileJson,
        gamesObserved: input.gamesObserved,
      })
      helpers.store.semanticWrites += 1
    },
    deleteWorkingMemory: async () => {
      helpers.store.workingMemoryDeletes += 1
    },
    saveWorkingMemory: async () => {},
    loadWorkingMemory: async () => null,
    loadAllSemanticForObserver: async () => new Map(),
  }
})

vi.mock('@/platform/db/queries/errors', async () => {
  const helpers = await import('./gm-v2-harness')
  return {
    recordAgentError: async (input: StoredAgentError) => {
      helpers.store.agentErrors.push(input)
    },
    listErrorsByMatch: async () => [],
    countErrorsByMatch: async () => 0,
  }
})

vi.mock('@/backend/a2a-core/client', async () => {
  const helpers = await import('./gm-v2-harness')
  return {
    requestAgentDecisionToy: async () => {
      if (helpers.store.agentEndpoint) return helpers.store.agentEndpoint()
      throw new Error('unexpected agent endpoint call (token should be missing)')
    },
    requestAgentDecisionRpc: async () => {
      throw new Error('not used in v2 GM')
    },
  }
})

import { keys } from '@/platform/redis/keys'
import { runMatchToCompletion, tickMatch } from '@/backend/orchestrator/game-master'
import { createAndStartMatch } from '@/backend/orchestrator/match-lifecycle'
import { forceEndMatch } from '@/backend/orchestrator/match-cleanup'

const POKER_AGENTS = ['agt_p1', 'agt_p2', 'agt_p3', 'agt_p4', 'agt_p5', 'agt_p6']
const WEREWOLF_AGENTS = ['agt_w1', 'agt_w2', 'agt_w3', 'agt_w4', 'agt_w5', 'agt_w6']

type FinalizedResult = {
  winnerFaction: string | null
  ranking: Array<{ agentId: string; rank: number; score: number }>
  stats?: Record<string, unknown>
}

function finalizedOf(matchId: string): FinalizedResult | undefined {
  const entry = store.finalized.find((row) => row.matchId === matchId)
  return entry?.result as FinalizedResult | undefined
}

function ranksUnique(result: FinalizedResult | undefined): boolean {
  const ranking = result?.ranking
  if (!Array.isArray(ranking) || ranking.length === 0) return false
  const ranks = ranking.map((row) => row.rank)
  return new Set(ranks).size === ranks.length && ranks.every((rank) => Number.isInteger(rank) && rank > 0)
}

beforeEach(() => {
  resetStore()
  for (const agentId of [...POKER_AGENTS, ...WEREWOLF_AGENTS]) {
    seedAgent(agentId, agentId.startsWith('agt_p') ? 'poker' : 'werewolf')
  }
  seedAgent('agt_mod', 'werewolf')
})

function deleteToken(matchId: string): void {
  void store.redis.del(keys.matchToken(matchId))
}

function matchEndPublished(matchId: string): boolean {
  return store.redis.published.some(
    (entry) => entry.channel === keys.matchChannel(matchId) && entry.message.includes('"kind":"match-end"'),
  )
}

/** 快速终局：起始 60 筹码 + 每 2 手翻倍盲注，若干手内自然分出冠军。 */
const FAST_POKER_CONFIG = {
  smallBlind: 2,
  bigBlind: 4,
  startingChips: 60,
  schedule: {
    handsPerLevel: 2,
    levels: [
      { sb: 2, bb: 4 },
      { sb: 10, bb: 20 },
      { sb: 30, bb: 60 },
      { sb: 100, bb: 200 },
    ],
  },
}

describe('GM v2 — poker：默认动作兜底驱动到终局', () => {
  it('drives a poker match to terminal classification via applyDefaultAction', async () => {
    const { matchId } = await createAndStartMatch({
      gameType: 'poker',
      agentIds: POKER_AGENTS,
      engineConfig: FAST_POKER_CONFIG,
    })
    deleteToken(matchId)

    await runMatchToCompletion(matchId, { maxTicks: 20_000 })

    // terminal：finalize 落库 + match-end SSE
    const finalized = finalizedOf(matchId)
    expect(finalized).toBeDefined()
    expect(ranksUnique(finalized)).toBe(true)
    expect(finalized?.ranking).toHaveLength(6)
    expect(finalized?.stats?.reason).toBe('natural')
    expect(matchEndPublished(matchId)).toBe(true)

    // 兜底路径：agent token 缺失 → agent-error 记录
    expect(store.agentErrors.some((error) => error.matchId === matchId && error.errorCode === 'agent-token-missing')).toBe(
      true,
    )

    // 事件信封（spec §3）
    const events = eventsOf(matchId)
    expect(events.length).toBeGreaterThan(20)
    for (const event of events) {
      expect(event.kind.startsWith('poker:v2:')).toBe(true)
      expect(event.payload.audience).toBeDefined()
    }
    // kind 映射抽样
    const kinds = new Set(events.map((event) => event.kind))
    for (const expected of [
      'poker:v2:match-config',
      'poker:v2:randomness-established',
      'poker:v2:hand-started',
      'poker:v2:deck-shuffled',
      'poker:v2:blinds-posted',
      'poker:v2:action-made',
      'poker:v2:hand-ended',
      'poker:v2:match-finished',
    ]) {
      expect(kinds.has(expected)).toBe(true)
    }
    // 受众映射抽样
    const holeCards = events.filter((event) => event.kind === 'poker:v2:hole-cards-dealt')
    expect(holeCards.length).toBeGreaterThan(0)
    expect(holeCards[0].visibility).toBe('role-restricted')
    expect(holeCards[0].restrictedTo).toEqual([`self:${holeCards[0].actorAgentId}`])
    const deckShuffled = events.find((event) => event.kind === 'poker:v2:deck-shuffled')
    expect(deckShuffled?.visibility).toBe('role-restricted')
    expect(deckShuffled?.restrictedTo).toEqual(['delayed-public'])
    const actionMade = events.find((event) => event.kind === 'poker:v2:action-made')
    expect(actionMade?.visibility).toBe('public')
    expect(actionMade?.restrictedTo).toBeNull()
    // 引擎 seq 单调无碰撞
    const seqs = events.map((event) => event.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)

    // 印象信号（扑克 hand-ended → synthesizeEpisodic）
    expect(store.episodic.length).toBeGreaterThan(0)
    expect(store.episodic.every((entry) => entry.observerAgentId !== entry.targetAgentId)).toBe(true)
    expect(store.semanticWrites).toBeGreaterThan(0)
  }, 120_000)

  it('persisted agent thinking keeps engine seq monotonic (reserved slot)', async () => {
    store.agentEndpoint = async () => ({
      action: { type: 'totally-bogus' },
      thinking: 'thinking hard about this one',
      fallback: false,
    })
    const { matchId } = await createAndStartMatch({
      gameType: 'poker',
      agentIds: ['agt_p1', 'agt_p2'],
      engineConfig: { smallBlind: 2, bigBlind: 4, startingChips: 80 },
    })
    // token 保留：走 endpoint（返回非法动作）→ normalize 失败 → 默认动作 + thinking 事件

    for (let i = 0; i < 8; i++) {
      const result = await tickMatch(matchId)
      if (result.done) break
    }

    const events = eventsOf(matchId)
    const thinking = events.filter((event) => event.kind === 'agent/thinking')
    expect(thinking.length).toBeGreaterThan(0)
    expect(thinking[0].payload.text).toBe('thinking hard about this one')
    expect(thinking[0].visibility).toBe('public')
    // 预留 seq 不与任何引擎事件碰撞，且引擎事件自身按 seq 单调
    const seqs = events.map((event) => event.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    const engineSeqs = events
      .filter((event) => event.kind !== 'agent/thinking')
      .map((event) => event.seq)
    expect([...engineSeqs].sort((a, b) => a - b)).toEqual(engineSeqs)
    // 非法动作 → agent-error 记录
    expect(
      store.agentErrors.some((error) => error.matchId === matchId && error.errorCode === 'agent-invalid-action'),
    ).toBe(true)
  })

  it('stopRequested finishes the poker match after the current hand (controlled-after-hand)', async () => {
    const { matchId } = await createAndStartMatch({
      gameType: 'poker',
      agentIds: POKER_AGENTS,
      engineConfig: FAST_POKER_CONFIG,
    })
    deleteToken(matchId)

    for (let i = 0; i < 5; i++) {
      const result = await tickMatch(matchId)
      if (result.done) break
    }
    await store.redis.set(keys.matchStopRequested(matchId), '1', 'EX', 24 * 60 * 60)
    await runMatchToCompletion(matchId, { maxTicks: 20_000 })

    const finalized = finalizedOf(matchId)
    expect(finalized).toBeDefined()
    expect(['controlled-after-hand', 'natural']).toContain(finalized?.stats?.reason)
    const events = eventsOf(matchId)
    if (finalized?.stats?.reason === 'controlled-after-hand') {
      expect(events.some((event) => event.kind === 'poker:v2:stop-requested')).toBe(true)
    }
  }, 120_000)

  it('force-end terminates immediately with engine2 ranking', async () => {
    const { matchId } = await createAndStartMatch({
      gameType: 'poker',
      agentIds: POKER_AGENTS,
      engineConfig: { smallBlind: 2, bigBlind: 4, startingChips: 60 },
    })
    deleteToken(matchId)
    for (let i = 0; i < 4; i++) {
      const result = await tickMatch(matchId)
      if (result.done) break
    }

    const result = await forceEndMatch(matchId)
    expect(result.ok).toBe(true)

    const events = eventsOf(matchId)
    const matchFinished = events.find((event) => event.kind === 'poker:v2:match-finished')
    expect(matchFinished).toBeDefined()
    expect((matchFinished?.payload.ranking as unknown[]).length).toBe(6)
    expect(matchFinished?.payload.reason).toBe('controlled-immediate')

    const finalized = finalizedOf(matchId)
    expect(finalized?.ranking).toHaveLength(6)
    expect(finalized?.stats?.reason).toBe('controlled-immediate')
    expect(ranksUnique(finalized)).toBe(true)
    expect(matchEndPublished(matchId)).toBe(true)
  })
})

describe('GM v2 — werewolf：默认动作兜底驱动到终局', () => {
  it('drives a werewolf match to terminal classification via applyDefaultAction', async () => {
    const { matchId } = await createAndStartMatch({
      gameType: 'werewolf',
      agentIds: WEREWOLF_AGENTS,
      moderatorAgentId: 'agt_mod',
      engineConfig: { boardId: 'base-6' },
    })
    deleteToken(matchId)

    await runMatchToCompletion(matchId, { maxTicks: 5_000 })

    const finalized = finalizedOf(matchId)
    expect(finalized).toBeDefined()
    // 全默认：空刀 + 弃票 → 无死亡 → maxDays 上限 → tie
    expect(finalized?.winnerFaction).toBe('tie')
    expect(finalized?.stats?.basis).toBe('max-days-cap')
    expect(finalized?.ranking).toHaveLength(6)
    expect(matchEndPublished(matchId)).toBe(true)

    const events = eventsOf(matchId)
    for (const event of events) {
      expect(event.kind.startsWith('werewolf:v2:')).toBe(true)
      expect(event.payload.audience).toBeDefined()
    }
    const kinds = new Set(events.map((event) => event.kind))
    for (const expected of [
      'werewolf:v2:matchStarted',
      'werewolf:v2:rolesAssigned',
      'werewolf:v2:teammatesRevealed',
      'werewolf:v2:phaseEntered',
      'werewolf:v2:wolfKillVote',
      'werewolf:v2:speech',
      'werewolf:v2:voteCast',
      'werewolf:v2:voteResult',
      'werewolf:v2:deathsAnnounced',
      'werewolf:v2:gameEnded',
    ]) {
      expect(kinds.has(expected)).toBe(true)
    }

    // 受众映射（spec §3：audience 是唯一可见性真相）
    const rolesAssigned = events.filter((event) => event.kind === 'werewolf:v2:rolesAssigned')
    expect(rolesAssigned).toHaveLength(6)
    for (const event of rolesAssigned) {
      expect(event.visibility).toBe('role-restricted')
      expect(event.restrictedTo).toEqual([`role-self:${event.actorAgentId}`])
    }
    const seedEvent = events.find((event) => event.kind === 'werewolf:v2:randomnessSeed')
    expect(seedEvent?.restrictedTo).toEqual(['moderator'])
    const wolfVote = events.find((event) => event.kind === 'werewolf:v2:wolfKillVote')
    expect(wolfVote?.restrictedTo).toEqual(['wolves'])
    const speech = events.find((event) => event.kind === 'werewolf:v2:speech')
    expect(speech?.visibility).toBe('public')
    expect(speech?.restrictedTo).toBeNull()
    // 默认动作事件带 isDefault 标记（WFR-304 / spec §4）
    expect(events.some((event) => event.payload.isDefault === true)).toBe(true)

    // seq 单调无碰撞
    const seqs = events.map((event) => event.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)

    // 狼人杀无印象信号
    expect(store.episodic.filter((entry) => entry.matchId === matchId)).toHaveLength(0)
  }, 120_000)

  it('force-end terminates the werewolf match with reveal + ranking', async () => {
    const { matchId } = await createAndStartMatch({
      gameType: 'werewolf',
      agentIds: WEREWOLF_AGENTS,
      moderatorAgentId: 'agt_mod',
      engineConfig: { boardId: 'base-6' },
    })
    deleteToken(matchId)
    for (let i = 0; i < 10; i++) {
      const result = await tickMatch(matchId)
      if (result.done) break
    }

    const result = await forceEndMatch(matchId)
    expect(result.ok).toBe(true)

    const events = eventsOf(matchId)
    const gameEnded = events.find((event) => event.kind === 'werewolf:v2:gameEnded')
    expect(gameEnded).toBeDefined()
    // 狼人引擎事件载荷嵌套于 payload.payload（引擎事件形态，spec §3 payload 保留本体）
    const endedPayload = gameEnded?.payload.payload as
      | { reveal?: unknown[]; basis?: string; winner?: string }
      | undefined
    expect(endedPayload?.reveal?.length).toBe(6)
    // 6 人无死亡：2 狼 vs 4 好人 → 存活多数裁（good）
    expect(endedPayload?.basis).toBe('terminated-immediate:alive-majority')
    expect(endedPayload?.winner).toBe('good')

    const finalized = finalizedOf(matchId)
    expect(finalized).toBeDefined()
    expect(['wolves', 'good', 'tie']).toContain(finalized?.winnerFaction)
    expect(ranksUnique(finalized)).toBe(true)
    expect(finalized?.ranking).toHaveLength(6)
  })
})

