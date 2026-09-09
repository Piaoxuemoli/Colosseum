/**
 * GM v2 — 简化阿瓦隆（R3-2 新品类冒烟）default-action 驱动到终局。
 *
 * 复用 tests/unit/backend/orchestrator/gm-v2-harness.ts（内存 Redis + DB
 * queries mock）：证明平台核心（GM 驱动循环 / 事件信封 / 生命周期）零改动
 * 即可跑通新注册的品类（NFR-08）。断言：terminal classify、信封
 * （kind/audience→visibility/restrictedTo）、seq 单调、排名、无印象信号。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eventsOf, resetStore, seedAgent, store } from '../../backend/orchestrator/gm-v2-harness'
import type { StoredAgentError, StoredEpisodic, StoredEvent } from '../../backend/orchestrator/gm-v2-harness'

vi.mock('@/platform/redis/client', async () => {
  const helpers = await import('../../backend/orchestrator/gm-v2-harness')
  return { redis: helpers.store.redis }
})

vi.mock('@/platform/db/client', () => ({ db: {} }))

vi.mock('@/platform/db/queries/events', async () => {
  const helpers = await import('../../backend/orchestrator/gm-v2-harness')
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
  const helpers = await import('../../backend/orchestrator/gm-v2-harness')
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
  const helpers = await import('../../backend/orchestrator/gm-v2-harness')
  return { findAgentById: async (id: string) => helpers.store.agents.get(id) }
})

vi.mock('@/platform/db/queries/memory', async () => {
  const helpers = await import('../../backend/orchestrator/gm-v2-harness')
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
  const helpers = await import('../../backend/orchestrator/gm-v2-harness')
  return {
    recordAgentError: async (input: StoredAgentError) => {
      helpers.store.agentErrors.push(input)
    },
    listErrorsByMatch: async () => [],
    countErrorsByMatch: async () => 0,
  }
})

vi.mock('@/backend/a2a-core/client', async () => {
  const helpers = await import('../../backend/orchestrator/gm-v2-harness')
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

const AVALON_AGENTS = ['agt_a1', 'agt_a2', 'agt_a3', 'agt_a4', 'agt_a5']

type FinalizedResult = {
  winnerFaction: string | null
  ranking: Array<{ agentId: string; rank: number; score: number; extra?: Record<string, unknown> }>
  stats?: Record<string, unknown>
}

function finalizedOf(matchId: string): FinalizedResult | undefined {
  const entry = store.finalized.find((row) => row.matchId === matchId)
  return entry?.result as FinalizedResult | undefined
}

beforeEach(() => {
  resetStore()
  for (const agentId of AVALON_AGENTS) seedAgent(agentId, 'avalon')
})

function deleteToken(matchId: string): void {
  void store.redis.del(keys.matchToken(matchId))
}

function matchEndPublished(matchId: string): boolean {
  return store.redis.published.some(
    (entry) => entry.channel === keys.matchChannel(matchId) && entry.message.includes('"kind":"match-end"'),
  )
}

describe('GM v2 — avalon：默认动作兜底驱动到终局（平台核心零改动）', () => {
  it('drives an avalon match to terminal classification via applyDefaultAction', async () => {
    const { matchId } = await createAndStartMatch({
      gameType: 'avalon',
      agentIds: AVALON_AGENTS,
    })
    deleteToken(matchId)

    await runMatchToCompletion(matchId, { maxTicks: 2_000 })

    // terminal：finalize 落库 + match-end SSE。
    // 全默认 = 全赞成 + 全成功 → 好人 2 任务成功（2 轮 × 8 步）。
    const finalized = finalizedOf(matchId)
    expect(finalized).toBeDefined()
    expect(finalized?.winnerFaction).toBe('good')
    expect(finalized?.stats?.basis).toBe('quests:2-0')
    expect(finalized?.ranking).toHaveLength(5)
    const ranks = finalized?.ranking.map((row) => row.rank) ?? []
    expect(new Set(ranks).size).toBe(ranks.length)
    expect(ranks).toContain(1)
    // 排名带角色/阵营 extra（终局可验证口径）
    expect(finalized?.ranking.every((row) => typeof row.extra?.role === 'string')).toBe(true)
    expect(matchEndPublished(matchId)).toBe(true)

    // 兜底路径：agent token 缺失 → agent-error 记录
    expect(store.agentErrors.some((error) => error.matchId === matchId && error.errorCode === 'agent-token-missing')).toBe(
      true,
    )

    // 事件信封（spec §3）：kind 前缀 + audience 本体全量落库
    const events = eventsOf(matchId)
    expect(events.length).toBeGreaterThan(20)
    for (const event of events) {
      expect(event.kind.startsWith('avalon:v2:')).toBe(true)
      expect(event.payload.audience).toBeDefined()
    }
    const kinds = new Set(events.map((event) => event.kind))
    for (const expected of [
      'avalon:v2:matchStarted',
      'avalon:v2:randomnessSeed',
      'avalon:v2:rolesAssigned',
      'avalon:v2:knowledgeRevealed',
      'avalon:v2:phaseEntered',
      'avalon:v2:leaderAssigned',
      'avalon:v2:teamProposed',
      'avalon:v2:voteCast',
      'avalon:v2:voteResult',
      'avalon:v2:questChoice',
      'avalon:v2:questResult',
      'avalon:v2:gameEnded',
    ]) {
      expect(kinds.has(expected), `missing kind ${expected}`).toBe(true)
    }

    // 受众映射（audience 是唯一可见性真相）
    const rolesAssigned = events.filter((event) => event.kind === 'avalon:v2:rolesAssigned')
    expect(rolesAssigned).toHaveLength(5)
    for (const event of rolesAssigned) {
      expect(event.visibility).toBe('role-restricted')
      expect(event.restrictedTo).toEqual([`role-self:${event.actorAgentId}`])
    }
    const seedEvent = events.find((event) => event.kind === 'avalon:v2:randomnessSeed')
    expect(seedEvent?.visibility).toBe('role-restricted')
    expect(seedEvent?.restrictedTo).toEqual(['delayed-public'])
    const teamProposed = events.find((event) => event.kind === 'avalon:v2:teamProposed')
    expect(teamProposed?.visibility).toBe('public')
    expect(teamProposed?.restrictedTo).toBeNull()
    const questChoice = events.find((event) => event.kind === 'avalon:v2:questChoice')
    expect(questChoice?.restrictedTo).toEqual([`role-self:${questChoice?.actorAgentId}`])
    const gameEnded = events.find((event) => event.kind === 'avalon:v2:gameEnded')
    expect(gameEnded?.restrictedTo).toEqual(['delayed-public'])
    expect((gameEnded?.payload.payload as { reveal?: unknown[] }).reveal).toHaveLength(5)

    // 引擎 seq 单调无碰撞
    const seqs = events.map((event) => event.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)

    // 默认动作事件带 isDefault 标记
    expect(events.some((event) => event.payload.isDefault === true)).toBe(true)

    // 阿瓦隆无印象信号（仅德扑提供 impressions 钩子）
    expect(store.episodic.filter((entry) => entry.matchId === matchId)).toHaveLength(0)
  }, 60_000)

  it('force-end terminates the avalon match with reveal + ranking', async () => {
    const { matchId } = await createAndStartMatch({
      gameType: 'avalon',
      agentIds: AVALON_AGENTS,
    })
    deleteToken(matchId)
    // 8 步默认推进 = 轮 1 提案 + 5 票 + 2 抉择 → 任务 1 成功（1-0），轮 2 提名中
    for (let i = 0; i < 8; i++) {
      const result = await tickMatch(matchId)
      if (result.done) break
    }

    const result = await forceEndMatch(matchId)
    expect(result.ok).toBe(true)

    const events = eventsOf(matchId)
    const gameEnded = events.find((event) => event.kind === 'avalon:v2:gameEnded')
    expect(gameEnded).toBeDefined()
    const endedPayload = gameEnded?.payload.payload as
      | { reveal?: unknown[]; basis?: string; winner?: string }
      | undefined
    expect(endedPayload?.reveal?.length).toBe(5)
    expect(endedPayload?.basis).toBe('terminated-immediate:quests-1-0')
    expect(endedPayload?.winner).toBe('good')

    const finalized = finalizedOf(matchId)
    expect(finalized).toBeDefined()
    expect(finalized?.winnerFaction).toBe('good')
    expect(finalized?.ranking).toHaveLength(5)
    expect(matchEndPublished(matchId)).toBe(true)
  })

  it('创建校验：avalon 固定 5 人（多/少/重复均拒绝）', async () => {
    await expect(
      createAndStartMatch({ gameType: 'avalon', agentIds: AVALON_AGENTS.slice(0, 4) }),
    ).rejects.toThrow(/exactly 5 player agents/)
    await expect(
      createAndStartMatch({ gameType: 'avalon', agentIds: [...AVALON_AGENTS, 'agt_extra'] }),
    ).rejects.toThrow(/exactly 5 player agents/)
    await expect(
      createAndStartMatch({ gameType: 'avalon', agentIds: ['agt_a1', 'agt_a1', 'agt_a3', 'agt_a4', 'agt_a5'] }),
    ).rejects.toThrow(/duplicate/)
  })
})
