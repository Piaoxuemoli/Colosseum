/**
 * GM v2 — 阿瓦隆（全量规则）集成测试。
 *
 * 复用 tests/unit/backend/orchestrator/gm-v2-harness.ts（内存 Redis + DB
 * queries mock）：证明平台核心（GM 驱动循环 / 事件信封 / 生命周期）零改动
 * 即可驱动全量规则品类（NFR-08 / AVR-N3）。
 *
 * 1. mock 决策端点（读 Redis 内引擎状态 → 按阶段生成动作）驱动完整局到终局
 *    （讨论 → 5 轮任务循环 → 刺杀环节 → 终局揭示，全 7 阶段 + 全 15 kind）；
 * 2. token 缺失 → applyDefaultAction 兜底驱动到连坐终局（AVR-304/403）；
 * 3. force-end 强制终局（AVR-405）；
 * 4. 创建校验板子化（预设人数 / 未知预设 / 重复 id）。
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
import type { AvalonEngineState } from '@/games/avalon/engine2'

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

/** mock 决策端点：读 Redis 内引擎状态，按当前阶段生成确定动作（全赞成全成功）。 */
async function smartAvalonDecision(): Promise<Record<string, unknown>> {
  const match = store.matches[store.matches.length - 1]
  const raw = await store.redis.get(keys.matchState(match.id))
  if (!raw) throw new Error('mock endpoint: no engine state in redis')
  const state = JSON.parse(raw) as AvalonEngineState
  const actor = state.pendingActor
  if (!actor) throw new Error('mock endpoint: no pending actor')
  let action: Record<string, unknown>
  switch (state.phase) {
    case 'discussion':
      action = { type: 'speak', text: `${actor}：好人按座位顺推即可` }
      break
    case 'proposal': {
      const teamSize = state.board.teamSizes[state.round - 1]
      action = { type: 'proposeTeam', teamIds: state.players.slice(0, teamSize).map((p) => p.playerId) }
      break
    }
    case 'teamVote':
      action = { type: 'vote', approve: true }
      break
    case 'quest':
      action = { type: 'quest', succeed: true }
      break
    case 'evilConsultation':
      action = { type: 'consult', text: `${actor} 合议：刺杀 1 号位` }
      break
    case 'assassination': {
      const target = state.players.find((player) => player.playerId !== actor)?.playerId
      if (!target) throw new Error('mock endpoint: no assassination target')
      action = { type: 'assassinate', targetId: target }
      break
    }
    default:
      throw new Error(`mock endpoint: unexpected phase ${state.phase}`)
  }
  return { action }
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

describe('GM v2 — avalon：mock 决策驱动完整局到终局（平台核心零改动）', () => {
  it('drives a full avalon match (3 good wins → consultation → assassination) to terminal', async () => {
    store.agentEndpoint = smartAvalonDecision
    const { matchId } = await createAndStartMatch({
      gameType: 'avalon',
      agentIds: AVALON_AGENTS,
      engineConfig: { preset: 'basic-5' },
    })

    await runMatchToCompletion(matchId, { maxTicks: 2_000 })

    // terminal：finalize 落库 + match-end SSE。
    const finalized = finalizedOf(matchId)
    expect(finalized).toBeDefined()
    expect(finalized?.ranking).toHaveLength(5)
    const ranks = finalized?.ranking.map((row) => row.rank) ?? []
    expect(new Set(ranks).size).toBe(ranks.length)
    expect(ranks).toContain(1)
    expect(finalized?.ranking.every((row) => typeof row.extra?.role === 'string')).toBe(true)
    expect(matchEndPublished(matchId)).toBe(true)

    // mock 全赞成全成功 → 好人 3 胜 → 刺杀「持刀者外第一名玩家」：
    // 是否命中梅林由种子决定；从终局揭示核对，不引入第二真相。
    const events = eventsOf(matchId)
    const gameEnded = events.find((event) => event.kind === 'avalon:v2:gameEnded')
    expect(gameEnded).toBeDefined()
    const endedPayload = gameEnded?.payload.payload as {
      winner?: string
      basis?: string
      reveal?: Array<{ playerId: string; role: string }>
    }
    const declared = events.find((event) => event.kind === 'avalon:v2:assassinationDeclared')
    const declaredPayload = declared?.payload.payload as { assassinId?: string; targetId?: string }
    const target = endedPayload?.reveal?.find((row) => row.playerId === declaredPayload?.targetId)
    expect(target).toBeDefined()
    expect(finalized?.winnerFaction).toBe(target?.role === 'merlin' ? 'evil' : 'good')
    expect(endedPayload?.basis).toMatch(/^quests:3-0;assassination-(hit|miss)$/)
    expect(finalized?.stats?.basis).toBe(endedPayload?.basis)
    expect(finalized?.stats?.assassination).toMatchObject({ targetId: declaredPayload?.targetId })

    // 全 7 阶段 + 全 15 kind 都出现在信封流
    const kinds = new Set(events.map((event) => event.kind))
    for (const expected of [
      'avalon:v2:matchStarted',
      'avalon:v2:randomnessSeed',
      'avalon:v2:rolesAssigned',
      'avalon:v2:knowledgeRevealed',
      'avalon:v2:phaseEntered',
      'avalon:v2:leaderAssigned',
      'avalon:v2:statementIssued',
      'avalon:v2:evilConsulted',
      'avalon:v2:teamProposed',
      'avalon:v2:voteCast',
      'avalon:v2:voteResult',
      'avalon:v2:questChoice',
      'avalon:v2:questResult',
      'avalon:v2:assassinationDeclared',
      'avalon:v2:gameEnded',
    ]) {
      expect(kinds.has(expected), `missing kind ${expected}`).toBe(true)
    }
    const phases = new Set(
      events
        .filter((event) => event.kind === 'avalon:v2:phaseEntered')
        .map((event) => (event.payload.payload as { phase: string }).phase),
    )
    for (const phase of ['discussion', 'proposal', 'teamVote', 'quest', 'evilConsultation', 'assassination', 'ended']) {
      expect(phases.has(phase), `missing phase ${phase}`).toBe(true)
    }

    // 受众映射（audience 是唯一可见性真相）
    for (const event of events) {
      expect(event.kind.startsWith('avalon:v2:')).toBe(true)
      expect(event.payload.audience).toBeDefined()
    }
    const rolesAssigned = events.filter((event) => event.kind === 'avalon:v2:rolesAssigned')
    expect(rolesAssigned).toHaveLength(5)
    for (const event of rolesAssigned) {
      expect(event.visibility).toBe('role-restricted')
      expect(event.restrictedTo).toEqual([`role-self:${event.actorAgentId}`])
    }
    const seedEvent = events.find((event) => event.kind === 'avalon:v2:randomnessSeed')
    expect(seedEvent?.visibility).toBe('role-restricted')
    expect(seedEvent?.restrictedTo).toEqual(['delayed-public'])
    // AVR-107 口径变更：表决公开记名 → public
    const voteCast = events.find((event) => event.kind === 'avalon:v2:voteCast')
    expect(voteCast?.visibility).toBe('public')
    expect(voteCast?.restrictedTo).toBeNull()
    // 合议副本：每条合议 × 每名坏人一份 role-self 副本
    const consulted = events.filter((event) => event.kind === 'avalon:v2:evilConsulted')
    expect(consulted.length).toBe(4) // 2 坏人 × 2 发言人
    for (const event of consulted) {
      expect(event.visibility).toBe('role-restricted')
      expect(event.restrictedTo?.[0]).toMatch(/^role-self:agt_/)
    }
    const questChoice = events.find((event) => event.kind === 'avalon:v2:questChoice')
    expect(questChoice?.restrictedTo).toEqual([`role-self:${questChoice?.actorAgentId}`])
    expect(gameEnded?.restrictedTo).toEqual(['delayed-public'])
    expect(endedPayload?.reveal).toHaveLength(5)

    // 引擎 seq 单调无碰撞
    const seqs = events.map((event) => event.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)

    // 显式决策路径：无 agent-error、无兜底事件
    expect(store.agentErrors.some((error) => error.matchId === matchId)).toBe(false)
    expect(events.some((event) => event.payload.isDefault === true)).toBe(false)

    // 阿瓦隆无印象信号（仅德扑提供 impressions 钩子）
    expect(store.episodic.filter((entry) => entry.matchId === matchId)).toHaveLength(0)
  }, 60_000)

  it('token 缺失 → 默认动作兜底驱动到连坐终局（全反对 → 轮 1 五连拒）', async () => {
    const { matchId } = await createAndStartMatch({
      gameType: 'avalon',
      agentIds: AVALON_AGENTS,
      engineConfig: { preset: 'basic-5' },
    })
    deleteToken(matchId)

    await runMatchToCompletion(matchId, { maxTicks: 2_000 })

    const finalized = finalizedOf(matchId)
    expect(finalized).toBeDefined()
    expect(finalized?.winnerFaction).toBe('evil')
    expect(finalized?.stats?.basis).toBe('connective-rejection:round-1')

    // 兜底路径：agent token 缺失 → agent-error 记录 + isDefault 标记事件
    expect(
      store.agentErrors.some((error) => error.matchId === matchId && error.errorCode === 'agent-token-missing'),
    ).toBe(true)
    const events = eventsOf(matchId)
    expect(events.some((event) => event.payload.isDefault === true)).toBe(true)
    // 默认发言 = 空文本跳过（AVR-304：不伪造文本）
    const statements = events.filter((event) => event.kind === 'avalon:v2:statementIssued')
    expect(statements).toHaveLength(5)
    expect(statements.every((event) => (event.payload.payload as { text: string }).text === '')).toBe(true)
  }, 60_000)

  it('force-end terminates with reveal + ranking（0:0 → tie 注明强制终结）', async () => {
    const { matchId } = await createAndStartMatch({
      gameType: 'avalon',
      agentIds: AVALON_AGENTS,
      engineConfig: { preset: 'basic-5' },
    })
    deleteToken(matchId)
    // 数步默认推进（讨论 + 首次提案）后强制终结
    for (let i = 0; i < 6; i++) {
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
    expect(endedPayload?.basis).toBe('terminated-immediate:quests-0-0')
    expect(endedPayload?.winner).toBe('tie')

    const finalized = finalizedOf(matchId)
    expect(finalized).toBeDefined()
    expect(finalized?.winnerFaction).toBe('tie')
    expect(finalized?.ranking).toHaveLength(5)
    expect(matchEndPublished(matchId)).toBe(true)
  })
})

describe('GM v2 — avalon 创建校验（板子化 validateAvalonCreate）', () => {
  it('预设人数对齐：basic-6 需 6 人；未知预设拒绝；重复 id 拒绝；缺省 basic-5', async () => {
    await expect(
      createAndStartMatch({ gameType: 'avalon', agentIds: AVALON_AGENTS.slice(0, 4) }),
    ).rejects.toThrow(/exactly 5 player agents/)
    await expect(
      createAndStartMatch({
        gameType: 'avalon',
        agentIds: AVALON_AGENTS,
        engineConfig: { preset: 'basic-6' },
      }),
    ).rejects.toThrow(/exactly 6 player agents/)
    await expect(
      createAndStartMatch({
        gameType: 'avalon',
        agentIds: AVALON_AGENTS,
        engineConfig: { preset: 'nope' },
      }),
    ).rejects.toThrow(/unknown/)
    await expect(
      createAndStartMatch({ gameType: 'avalon', agentIds: ['agt_a1', 'agt_a1', 'agt_a3', 'agt_a4', 'agt_a5'] }),
    ).rejects.toThrow(/duplicate/)

    // basic-10 板可开 10 人局（引擎路径，无 LLM）
    const ten = Array.from({ length: 10 }, (_, i) => `agt_x${i}`)
    for (const agentId of ten) seedAgent(agentId, 'avalon')
    const created = await createAndStartMatch({
      gameType: 'avalon',
      agentIds: ten,
      engineConfig: { preset: 'base-10' },
    })
    const started = eventsOf(created.matchId).find((event) => event.kind === 'avalon:v2:matchStarted')
    expect((started?.payload.payload as { boardId?: string }).boardId).toBe('base-10')
    expect((started?.payload.payload as { seats?: unknown[] }).seats).toHaveLength(10)
  })
})
