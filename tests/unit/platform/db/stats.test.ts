// FR-4.6-05（R3-5 选手排行聚合）+ FR-4.8-03（R3-6 用量聚合）：stats 查询层。
// 内存 SQLite + 真实迁移链建库，种子数据覆盖 poker / werewolf / 平局 /
// 缺排名 / 未完成对局 / 无主调用等分支。

import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from './helpers'
import { agents, apiProfiles, llmUsage, matches, matchParticipants } from '@/platform/db/schema.sqlite'
import {
  getAgentLeaderboard,
  getMatchUsageDigest,
  getUsageAggregates,
  parseRankingRows,
  parseUsageGroupBy,
  parseUsagePurposeFilter,
  rankingRowOutcome,
  UsageQueryError,
} from '@/platform/db/queries/stats'

// ── 种子 ────────────────────────────────────────────────────────────────────

const T0 = new Date('2026-09-01T00:00:00Z')
const T1 = new Date('2026-09-02T00:00:00Z')
const T2 = new Date('2026-09-03T00:00:00Z')

const A1 = 'agt_alpha'
const A2 = 'agt_bravo'
const W1 = 'agt_wolfone'
const W2 = 'agt_wolftwo'

const M1 = 'match_poker_1'
const M2 = 'match_poker_2'
const M3 = 'match_wolf_1'
const M4 = 'match_running'
const M5 = 'match_no_ranking'
const M6 = 'match_wolf_tie'

let db: ReturnType<typeof createTestDb>

async function seed(): Promise<void> {
  await db.insert(apiProfiles).values({
    id: 'prof_test',
    displayName: 'Test Profile',
    providerId: 'openai-compatible',
    baseUrl: 'https://example.invalid/v1',
    model: 'test-model',
  })

  await db.insert(agents).values([
    { id: A1, displayName: 'Alpha', gameType: 'poker', profileId: 'prof_test', systemPrompt: 's' },
    { id: A2, displayName: 'Bravo', gameType: 'poker', profileId: 'prof_test', systemPrompt: 's' },
    { id: W1, displayName: 'WolfOne', gameType: 'werewolf', profileId: 'prof_test', systemPrompt: 's' },
    { id: W2, displayName: 'WolfTwo', gameType: 'werewolf', profileId: 'prof_test', systemPrompt: 's' },
  ])

  await db.insert(matches).values([
    {
      id: M1,
      gameType: 'poker',
      status: 'completed',
      config: {},
      startedAt: T0,
      completedAt: T0,
      winnerFaction: A1,
      finalRanking: {
        winnerFaction: A1,
        ranking: [
          { agentId: A1, rank: 1, score: 3000, extra: { chips: 3000 } },
          { agentId: A2, rank: 2, score: 0, extra: { chips: 0 } },
        ],
      },
    },
    {
      id: M2,
      gameType: 'poker',
      status: 'completed',
      config: {},
      startedAt: T1,
      completedAt: T1,
      winnerFaction: A2,
      finalRanking: {
        winnerFaction: A2,
        ranking: [
          { agentId: A2, rank: 1, score: 1800, extra: { chips: 1800 } },
          { agentId: A1, rank: 2, score: 0, extra: { chips: 0 } },
        ],
      },
    },
    {
      id: M3,
      gameType: 'werewolf',
      status: 'completed',
      config: {},
      startedAt: T1,
      completedAt: T1,
      winnerFaction: 'wolves',
      finalRanking: {
        winnerFaction: 'wolves',
        ranking: [
          { agentId: W1, rank: 1, score: 1, extra: { role: 'wolf', alive: true } },
          { agentId: W2, rank: 2, score: 1, extra: { role: 'wolf', alive: false } },
        ],
      },
    },
    // 未完成对局：不参与跨对局统计。
    {
      id: M4,
      gameType: 'poker',
      status: 'running',
      config: {},
      startedAt: T2,
      completedAt: null,
      winnerFaction: null,
      finalRanking: null,
    },
    // 已完成但缺 finalRanking：计入场次，不计名次 / 胜负。
    {
      id: M5,
      gameType: 'poker',
      status: 'completed',
      config: {},
      startedAt: T2,
      completedAt: T2,
      winnerFaction: null,
      finalRanking: null,
    },
    // 狼人杀平局：全员 score=1 也不应计胜。
    {
      id: M6,
      gameType: 'werewolf',
      status: 'completed',
      config: {},
      startedAt: T2,
      completedAt: T2,
      winnerFaction: 'tie',
      finalRanking: {
        winnerFaction: 'tie',
        ranking: [{ agentId: W1, rank: 1, score: 1, extra: { role: 'wolf', alive: true } }],
      },
    },
  ])

  await db.insert(matchParticipants).values([
    { matchId: M1, agentId: A1, seatIndex: 0 },
    { matchId: M1, agentId: A2, seatIndex: 1 },
    { matchId: M2, agentId: A1, seatIndex: 0 },
    { matchId: M2, agentId: A2, seatIndex: 1 },
    { matchId: M3, agentId: W1, seatIndex: 0 },
    { matchId: M3, agentId: W2, seatIndex: 1 },
    { matchId: M4, agentId: A1, seatIndex: 0 },
    { matchId: M5, agentId: A1, seatIndex: 0 },
    { matchId: M6, agentId: W1, seatIndex: 0 },
  ])

  await db.insert(llmUsage).values([
    // M1 / Alpha：一次有 token，一次供应方未上报（null）。
    {
      id: 'u1',
      matchId: M1,
      agentId: A1,
      profileId: 'prof_test',
      purpose: 'agent-decision',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      model: 'test-model',
      createdAt: T0,
    },
    {
      id: 'u2',
      matchId: M1,
      agentId: A1,
      profileId: 'prof_test',
      purpose: 'agent-decision',
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      model: 'test-model',
      createdAt: T0,
    },
    // M2 / Bravo。
    {
      id: 'u3',
      matchId: M2,
      agentId: A2,
      profileId: 'prof_test',
      purpose: 'agent-decision',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      model: 'test-model',
      createdAt: T1,
    },
    // M3 / WolfOne：主持用途（枚举预留口径的读路径验证）。
    {
      id: 'u4',
      matchId: M3,
      agentId: W1,
      profileId: 'prof_test',
      purpose: 'moderator-narration',
      promptTokens: 7,
      completionTokens: 3,
      totalTokens: 10,
      model: 'test-model',
      createdAt: T1,
    },
    // 非对局调用（配置测试）：无 matchId / agentId。
    {
      id: 'u5',
      matchId: null,
      agentId: null,
      profileId: null,
      purpose: 'profile-test',
      promptTokens: 5,
      completionTokens: 5,
      totalTokens: 10,
      model: 'test-model',
      createdAt: T2,
    },
  ])
}

beforeEach(async () => {
  db = createTestDb()
  await seed()
})

// ── 纯函数 ──────────────────────────────────────────────────────────────────

describe('parseRankingRows', () => {
  it('extracts the ranking array', () => {
    const rows = parseRankingRows({ ranking: [{ agentId: 'a', rank: 1 }] })
    expect(rows).toHaveLength(1)
  })

  it('tolerates garbage', () => {
    expect(parseRankingRows(null)).toEqual([])
    expect(parseRankingRows({})).toEqual([])
    expect(parseRankingRows({ ranking: 'oops' })).toEqual([])
    expect(parseRankingRows({ ranking: [null, 5, { agentId: 'a' }] })).toEqual([{ agentId: 'a' }])
  })
})

describe('rankingRowOutcome', () => {
  it('poker: rank 1 wins and survives; rank > 1 eliminated', () => {
    expect(rankingRowOutcome('poker', 'agt_x', { rank: 1 })).toEqual({
      rank: 1,
      win: true,
      survived: true,
      eliminated: false,
    })
    expect(rankingRowOutcome('poker', 'agt_x', { rank: 3 })).toEqual({
      rank: 3,
      win: false,
      survived: false,
      eliminated: true,
    })
  })

  it('poker: missing rank stays unknown', () => {
    expect(rankingRowOutcome('poker', null, { rank: 'x' }).rank).toBeNull()
    expect(rankingRowOutcome('poker', null, {}).eliminated).toBeNull()
  })

  it('werewolf: score 1 counts as win only with a decided faction', () => {
    const row = { rank: 2, score: 1, extra: { alive: false } }
    expect(rankingRowOutcome('werewolf', 'wolves', row)).toEqual({
      rank: 2,
      win: true,
      survived: false,
      eliminated: true,
    })
    // 平局全员 score=1，不属胜局。
    expect(rankingRowOutcome('werewolf', 'tie', row).win).toBe(false)
    expect(rankingRowOutcome('werewolf', null, row).win).toBe(false)
  })

  it('werewolf: alive flag drives survived/eliminated; missing extra stays unknown', () => {
    expect(rankingRowOutcome('werewolf', 'good', { rank: 1, score: 1, extra: { alive: true } }).survived).toBe(true)
    expect(rankingRowOutcome('werewolf', 'good', { rank: 1, score: 1 }).survived).toBeNull()
  })
})

describe('parseUsageGroupBy / parseUsagePurposeFilter', () => {
  it('defaults to agent and trims', () => {
    expect(parseUsageGroupBy(null)).toBe('agent')
    expect(parseUsageGroupBy('  ')).toBe('agent')
    expect(parseUsageGroupBy(' day ')).toBe('day')
  })

  it('rejects unknown values', () => {
    expect(() => parseUsageGroupBy('week')).toThrow(UsageQueryError)
  })

  it('validates purpose filter', () => {
    expect(parseUsagePurposeFilter(null)).toBeNull()
    expect(parseUsagePurposeFilter('commentary')).toBe('commentary')
    expect(() => parseUsagePurposeFilter('narration')).toThrow(UsageQueryError)
  })
})

// ── 选手排行（FR-4.6-05） ───────────────────────────────────────────────────

describe('getAgentLeaderboard', () => {
  it('aggregates per agent across completed matches only', async () => {
    const rows = await getAgentLeaderboard(db)
    const byId = new Map(rows.map((row) => [row.agentId, row]))

    const alpha = byId.get(A1)
    expect(alpha).toBeDefined()
    // M1 胜 + M2 出局 + M5 无排名；M4 running 不计。
    expect(alpha?.matchesPlayed).toBe(3)
    expect(alpha?.wins).toBe(1)
    expect(alpha?.rankableMatches).toBe(2)
    expect(alpha?.avgRank).toBe(1.5)
    expect(alpha?.bestRank).toBe(1)
    expect(alpha?.survived).toBe(1)
    expect(alpha?.eliminated).toBe(1)
    expect(alpha?.winRate).toBeCloseTo(1 / 3, 3)
    expect(alpha?.lastPlayedAt?.getTime()).toBe(T2.getTime())

    const bravo = byId.get(A2)
    expect(bravo?.matchesPlayed).toBe(2)
    expect(bravo?.wins).toBe(1)

    // 缺 finalRanking 的 M5：计场不计名次。
    expect(alpha?.rankableMatches).toBe(2)
  })

  it('werewolf: faction win counts even when eliminated; tie does not', async () => {
    const rows = await getAgentLeaderboard(db, { gameType: 'werewolf' })
    const byId = new Map(rows.map((row) => [row.agentId, row]))

    // W1: M3 win survived; M6 tie 不计胜。
    expect(byId.get(W1)?.matchesPlayed).toBe(2)
    expect(byId.get(W1)?.wins).toBe(1)
    expect(byId.get(W1)?.survived).toBe(2)
    expect(byId.get(W1)?.eliminated).toBe(0)
    expect(byId.get(W1)?.lastPlayedAt?.getTime()).toBe(T2.getTime())

    // W2: M3 阵亡但属胜方阵营 → win + eliminated。
    expect(byId.get(W2)?.wins).toBe(1)
    expect(byId.get(W2)?.eliminated).toBe(1)
  })

  it('sorts by wins, then win rate, then matches, then avg rank', async () => {
    const rows = await getAgentLeaderboard(db)
    // 全员 1 胜 → 胜率：W2(100%) > W1=A2(50%) > A1(33%)；W1 与 A2 场次
    // 相同，按平均名次 W1(1) 先于 A2(1.5)。
    expect(rows.map((row) => row.agentId)).toEqual([W2, W1, A2, A1])
    const pokerRows = await getAgentLeaderboard(db, { gameType: 'poker' })
    expect(pokerRows.map((row) => row.agentId)).toEqual([A2, A1])
  })

  it('respects gameType filter and limit', async () => {
    expect(await getAgentLeaderboard(db, { gameType: 'werewolf' })).toHaveLength(2)
    expect(await getAgentLeaderboard(db, { gameType: 'poker' })).toHaveLength(2)
    expect(await getAgentLeaderboard(db, { limit: 1 })).toHaveLength(1)
  })
})

// ── 用量聚合（FR-4.8-03） ───────────────────────────────────────────────────

describe('getUsageAggregates', () => {
  it('groups by agent with display names and null-key ownerless rows', async () => {
    const result = await getUsageAggregates(db, { groupBy: 'agent' })
    const byKey = new Map(result.rows.map((row) => [row.agentId ?? '__none__', row]))

    const alpha = byKey.get(A1)
    expect(alpha?.displayName).toBe('Alpha')
    expect(alpha?.calls).toBe(2)
    expect(alpha?.promptTokens).toBe(100) // null 不计
    expect(alpha?.completionTokens).toBe(50)
    expect(alpha?.totalTokens).toBe(150)
    expect(alpha?.knownTokenCalls).toBe(1)

    const none = byKey.get('__none__')
    expect(none?.calls).toBe(1)
    expect(none?.displayName).toBeNull()

    expect(result.totals.calls).toBe(5)
    expect(result.totals.promptTokens).toBe(122)
    expect(result.totals.completionTokens).toBe(63)
    expect(result.totals.totalTokens).toBe(185)
    expect(result.totals.knownTokenCalls).toBe(4)
  })

  it('groups by purpose', async () => {
    const result = await getUsageAggregates(db, { groupBy: 'purpose' })
    const byPurpose = new Map(result.rows.map((row) => [row.key, row]))
    expect(byPurpose.get('agent-decision')?.calls).toBe(3)
    expect(byPurpose.get('agent-decision')?.totalTokens).toBe(165)
    expect(byPurpose.get('moderator-narration')?.calls).toBe(1)
    expect(byPurpose.get('profile-test')?.calls).toBe(1)
  })

  it('groups by UTC day', async () => {
    const result = await getUsageAggregates(db, { groupBy: 'day' })
    const byDay = new Map(result.rows.map((row) => [row.key, row]))
    expect(byDay.get('2026-09-01')?.calls).toBe(2)
    expect(byDay.get('2026-09-02')?.calls).toBe(2)
    expect(byDay.get('2026-09-03')?.calls).toBe(1)
  })

  it('filters by matchId / agentId / purpose', async () => {
    const byMatch = await getUsageAggregates(db, { groupBy: 'agent', matchId: M1 })
    expect(byMatch.rows).toHaveLength(1)
    expect(byMatch.rows[0].agentId).toBe(A1)
    expect(byMatch.totals.calls).toBe(2)

    const byAgent = await getUsageAggregates(db, { groupBy: 'purpose', agentId: A1 })
    expect(byAgent.totals.calls).toBe(2)

    const byPurpose = await getUsageAggregates(db, { groupBy: 'agent', purpose: 'profile-test' })
    expect(byPurpose.rows).toHaveLength(1)
    expect(byPurpose.rows[0].agentId).toBeNull()

    expect(byMatch.filter).toMatchObject({ matchId: M1, agentId: null, purpose: null })
  })
})

describe('getMatchUsageDigest', () => {
  it('returns per-agent and per-purpose totals for the match', async () => {
    const digest = await getMatchUsageDigest(db, M1)
    expect(digest.byAgent).toHaveLength(1)
    expect(digest.byAgent[0]).toMatchObject({
      agentId: A1,
      displayName: 'Alpha',
      calls: 2,
      totalTokens: 150,
      knownTokenCalls: 1,
    })
    expect(digest.byPurpose).toEqual([
      { purpose: 'agent-decision', calls: 2, promptTokens: 100, completionTokens: 50, totalTokens: 150, knownTokenCalls: 1 },
    ])
    expect(digest.totals.calls).toBe(2)
  })

  it('returns zeroed digest for a match without usage', async () => {
    const digest = await getMatchUsageDigest(db, M5)
    expect(digest.byAgent).toEqual([])
    expect(digest.byPurpose).toEqual([])
    expect(digest.totals.calls).toBe(0)
  })
})
