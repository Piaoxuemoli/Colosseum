// FR-4.6-05（R3-5 跨对局统计聚合，观众面）+ FR-4.8-03 / NFR-06（R3-6 用量
// 聚合）的查询层。
//
// 约定：
// - 所有函数显式接收 `dbh`（Drizzle 实例）而非隐式单例——API route 传入
//   `@/platform/db/client` 的 db，单测注入内存 SQLite（tests/unit 镜像）。
// - 跨对局画像只从 `matches` + `finalRanking` JSON 这类廉价来源聚合，不扫
//   game_events（PRD FR-4.6-05 观众面；行为倾向等重组件画像随 OD-5 后置）。
// - 选手胜负判定按各游戏在 MatchResult 契约上已写明的语义读数：
//   · poker  ：rank === 1 为冠军（winnerFaction 列即冠军 agentId）。
//   · werewolf / avalon：score === 1 为胜方阵营成员，且 winnerFaction 为
//     有效阵营（wolves/good/evil）时才计胜（tie 时全员 score=1，不属胜局）。
//   该 per-game 读数集中在本文件一处，不进入 games/ 包（games 自治不受影响）。

import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm'
import { agents, llmUsage, matches, matchParticipants } from '@/platform/db/schema.sqlite'
import type { DB } from '@/platform/db/client'
import { llmUsagePurposeSchema, type LlmUsagePurpose } from '@/platform/core/types'

// ---------------------------------------------------------------------------
// FR-4.6-05：跨对局选手排行（仅 completed 对局）
// ---------------------------------------------------------------------------

export type RankingRowLike = {
  agentId?: unknown
  rank?: unknown
  score?: unknown
  extra?: unknown
}

export type RankingRowOutcome = {
  rank: number | null
  win: boolean
  survived: boolean | null
  eliminated: boolean | null
}

/**
 * 从 finalRanking JSON 取 ranking 数组（纯函数，供测试）。非对象 / 缺
 * ranking / 非数组一律返回空——坏数据不参与统计而不是炸查询。
 */
export function parseRankingRows(finalRanking: unknown): RankingRowLike[] {
  if (typeof finalRanking !== 'object' || finalRanking === null) return []
  const rows = (finalRanking as { ranking?: unknown }).ranking
  return Array.isArray(rows) ? (rows.filter((row) => typeof row === 'object' && row !== null) as RankingRowLike[]) : []
}

/**
 * 单个 ranking 行 → 观众面统计读数（纯函数，供测试）。gameType 取自
 * matches.game_type（与 agents.game_type 一致）；未知品类按 poker 口径
 * （rank 1 冠军）兜底，行为可预期且不抛错。
 */
export function rankingRowOutcome(
  gameType: string,
  winnerFaction: string | null,
  row: RankingRowLike,
): RankingRowOutcome {
  const rawRank = row.rank
  const rank =
    typeof rawRank === 'number' && Number.isFinite(rawRank) && rawRank >= 1 ? Math.trunc(rawRank) : null

  if (gameType === 'werewolf' || gameType === 'avalon') {
    // 阵营游戏（FR-4.9-01 口径 6：胜负判定与观众面同源）：score === 1 且
    // winnerFaction 为有效阵营才计胜；tie 全员 score=1 不属胜局（ELO 侧
    // 另按「全体同分 → 平局跳过」处理）。
    const factionWon =
      winnerFaction === 'wolves' || winnerFaction === 'good' || winnerFaction === 'evil'
    const win = factionWon && row.score === 1
    if (gameType === 'werewolf') {
      const alive = typeof row.extra === 'object' && row.extra !== null ? (row.extra as { alive?: unknown }).alive : undefined
      const survived = alive === true ? true : alive === false ? false : null
      return { rank, win, survived, eliminated: survived === null ? null : !survived }
    }
    return { rank, win, survived: win, eliminated: !win }
  }

  // poker 及默认口径
  return {
    rank,
    win: rank === 1,
    survived: rank === 1,
    eliminated: rank === null ? null : rank > 1,
  }
}

export type AgentLeaderboardRow = {
  agentId: string
  displayName: string
  avatarEmoji: string | null
  gameType: string
  /** 已完成对局的参与场数。 */
  matchesPlayed: number
  /** 有可读名次的场数（finalRanking 缺失 / 行无 rank 时不计）。 */
  rankableMatches: number
  wins: number
  /** wins / matchesPlayed，保留 4 位；0 场时为 null。 */
  winRate: number | null
  avgRank: number | null
  bestRank: number | null
  survived: number
  eliminated: number
  /** 最近一次 completed 对局的完成时间。 */
  lastPlayedAt: Date | null
}

export type LeaderboardFilter = {
  gameType?: 'poker' | 'werewolf' | 'avalon'
  limit?: number
}

/**
 * 跨对局选手排行（仅 completed 对局）：单用户部署规模下取全部已完成对局
 * 的 finalRanking，在 JS 侧归并（SQL 侧只做 join 与过滤）。排序：胜场 →
 * 胜率 → 场次 → 平均名次（无名次者垫底）→ 显示名。
 */
export async function getAgentLeaderboard(
  dbh: DB,
  filter: LeaderboardFilter = {},
): Promise<AgentLeaderboardRow[]> {
  const conditions = [eq(matches.status, 'completed')]
  if (filter.gameType) conditions.push(eq(matches.gameType, filter.gameType))

  const rows = await dbh
    .select({
      agentId: matchParticipants.agentId,
      displayName: agents.displayName,
      avatarEmoji: agents.avatarEmoji,
      gameType: matches.gameType,
      completedAt: matches.completedAt,
      winnerFaction: matches.winnerFaction,
      finalRanking: matches.finalRanking,
    })
    .from(matchParticipants)
    .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
    .innerJoin(agents, eq(matchParticipants.agentId, agents.id))
    .where(and(...conditions))

  type Acc = Omit<AgentLeaderboardRow, 'winRate' | 'avgRank'> & { rankSum: number }
  const byAgent = new Map<string, Acc>()

  for (const row of rows) {
    let acc = byAgent.get(row.agentId)
    if (!acc) {
      acc = {
        agentId: row.agentId,
        displayName: row.displayName,
        avatarEmoji: row.avatarEmoji,
        gameType: row.gameType,
        matchesPlayed: 0,
        rankableMatches: 0,
        wins: 0,
        bestRank: null,
        survived: 0,
        eliminated: 0,
        lastPlayedAt: null,
        rankSum: 0,
      }
      byAgent.set(row.agentId, acc)
    }
    acc.matchesPlayed += 1

    if (row.completedAt && (!acc.lastPlayedAt || row.completedAt > acc.lastPlayedAt)) {
      acc.lastPlayedAt = row.completedAt
    }

    const ownRow = parseRankingRows(row.finalRanking).find(
      (candidate) => typeof candidate.agentId === 'string' && candidate.agentId === row.agentId,
    )
    if (!ownRow) continue
    const outcome = rankingRowOutcome(row.gameType, row.winnerFaction, ownRow)
    if (outcome.win) acc.wins += 1
    if (outcome.rank !== null) {
      acc.rankableMatches += 1
      acc.rankSum += outcome.rank
      acc.bestRank = acc.bestRank === null ? outcome.rank : Math.min(acc.bestRank, outcome.rank)
    }
    if (outcome.survived === true) acc.survived += 1
    if (outcome.eliminated === true) acc.eliminated += 1
  }

  const leaderboard: AgentLeaderboardRow[] = [...byAgent.values()].map((acc) => ({
    agentId: acc.agentId,
    displayName: acc.displayName,
    avatarEmoji: acc.avatarEmoji,
    gameType: acc.gameType,
    matchesPlayed: acc.matchesPlayed,
    rankableMatches: acc.rankableMatches,
    wins: acc.wins,
    winRate: acc.matchesPlayed > 0 ? Number((acc.wins / acc.matchesPlayed).toFixed(4)) : null,
    avgRank: acc.rankableMatches > 0 ? Number((acc.rankSum / acc.rankableMatches).toFixed(2)) : null,
    bestRank: acc.bestRank,
    survived: acc.survived,
    eliminated: acc.eliminated,
    lastPlayedAt: acc.lastPlayedAt,
  }))

  leaderboard.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    const aRate = a.winRate ?? -1
    const bRate = b.winRate ?? -1
    if (bRate !== aRate) return bRate - aRate
    if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed
    const aRank = a.avgRank ?? Number.POSITIVE_INFINITY
    const bRank = b.avgRank ?? Number.POSITIVE_INFINITY
    if (aRank !== bRank) return aRank - bRank
    return a.displayName.localeCompare(b.displayName)
  })

  return filter.limit ? leaderboard.slice(0, filter.limit) : leaderboard
}

// ---------------------------------------------------------------------------
// FR-4.8-03：LLM 用量聚合
// ---------------------------------------------------------------------------

export type UsageGroupBy = 'agent' | 'purpose' | 'day'

export class UsageQueryError extends Error {}

/** URL 参数 → groupBy。空 / 缺省为 agent；非法值抛 UsageQueryError（回 400）。 */
export function parseUsageGroupBy(value: string | null | undefined): UsageGroupBy {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return 'agent'
  if (trimmed === 'agent' || trimmed === 'purpose' || trimmed === 'day') return trimmed
  throw new UsageQueryError(`groupBy 仅支持 agent / purpose / day，收到：${trimmed}`)
}

/** URL 参数 → purpose 过滤。空为不过滤；非法值抛 UsageQueryError。 */
export function parseUsagePurposeFilter(value: string | null | undefined): LlmUsagePurpose | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return null
  const parsed = llmUsagePurposeSchema.safeParse(trimmed)
  if (!parsed.success) {
    throw new UsageQueryError(
      `purpose 仅支持 ${llmUsagePurposeSchema.options.join(' / ')}，收到：${trimmed}`,
    )
  }
  return parsed.data
}

export type UsageFilter = {
  matchId?: string | null
  agentId?: string | null
  purpose?: LlmUsagePurpose | null
}

export type UsageTotals = {
  calls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** totalTokens 非 null 的调用数——供应方未上报用量时的透明度口径。 */
  knownTokenCalls: number
}

export type UsageAggregateRow = UsageTotals & {
  /** 分组键：agentId（可 null=非对局调用）| purpose | 'YYYY-MM-DD'（UTC 日）。 */
  key: string | null
  agentId: string | null
  displayName: string | null
}

export type UsageAggregates = {
  groupBy: UsageGroupBy
  filter: { matchId: string | null; agentId: string | null; purpose: LlmUsagePurpose | null }
  rows: UsageAggregateRow[]
  totals: UsageTotals
}

function usageConditions(filter: UsageFilter): SQL | undefined {
  const conditions: SQL[] = []
  if (filter.matchId) conditions.push(eq(llmUsage.matchId, filter.matchId))
  if (filter.agentId) conditions.push(eq(llmUsage.agentId, filter.agentId))
  if (filter.purpose) conditions.push(eq(llmUsage.purpose, filter.purpose))
  return conditions.length > 0 ? and(...conditions) : undefined
}

const usageSums = {
  calls: sql<number>`count(*)`,
  promptTokens: sql<number>`coalesce(sum(${llmUsage.promptTokens}), 0)`,
  completionTokens: sql<number>`coalesce(sum(${llmUsage.completionTokens}), 0)`,
  totalTokens: sql<number>`coalesce(sum(${llmUsage.totalTokens}), 0)`,
  knownTokenCalls: sql<number>`coalesce(sum(case when ${llmUsage.totalTokens} is not null then 1 else 0 end), 0)`,
}

const totalTokensExpr = sql<number>`coalesce(sum(${llmUsage.totalTokens}), 0)`

/**
 * llm_usage 聚合查询：按 agent / purpose / day 分组，可选 matchId / agentId /
 * purpose 过滤。行序：总 token 降序 → 调用数降序 → 键升序（稳定展示）。
 * day 分组的键是 SQLite date(created_at,'unixepoch')，即 UTC 日。
 */
export async function getUsageAggregates(
  dbh: DB,
  filter: UsageFilter & { groupBy: UsageGroupBy },
): Promise<UsageAggregates> {
  const where = usageConditions(filter)

  const rows: UsageAggregateRow[] =
    filter.groupBy === 'purpose'
      ? await dbh
          .select({ key: llmUsage.purpose, agentId: sql<string | null>`null`, displayName: sql<string | null>`null`, ...usageSums })
          .from(llmUsage)
          .where(where)
          .groupBy(llmUsage.purpose)
          .orderBy(desc(totalTokensExpr), desc(usageSums.calls), asc(llmUsage.purpose))
      : filter.groupBy === 'day'
        ? await dbh
            .select({
                key: sql<string>`date(${llmUsage.createdAt}, 'unixepoch')`,
                agentId: sql<string | null>`null`,
                displayName: sql<string | null>`null`,
                ...usageSums,
              })
            .from(llmUsage)
            .where(where)
            .groupBy(sql`date(${llmUsage.createdAt}, 'unixepoch')`)
            .orderBy(asc(sql`date(${llmUsage.createdAt}, 'unixepoch')`))
        : await dbh
            .select({ key: llmUsage.agentId, agentId: llmUsage.agentId, displayName: agents.displayName, ...usageSums })
            .from(llmUsage)
            .leftJoin(agents, eq(agents.id, llmUsage.agentId))
            .where(where)
            .groupBy(llmUsage.agentId)
            .orderBy(desc(totalTokensExpr), desc(usageSums.calls), asc(llmUsage.agentId))

  const totalRows = await dbh.select(usageSums).from(llmUsage).where(where)
  const totalsRow = totalRows[0]

  return {
    groupBy: filter.groupBy,
    filter: {
      matchId: filter.matchId ?? null,
      agentId: filter.agentId ?? null,
      purpose: filter.purpose ?? null,
    },
    rows: rows.map((row) => ({ ...row, ...normalizeTotals(row) })),
    totals: normalizeTotals(totalsRow),
  }
}

/** better-sqlite3 的 sum/count 已是 number；此处再兜一层防 NaN/undefined。 */
function normalizeTotals(row: unknown): UsageTotals {
  const r = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>
  const pick = (key: string): number => {
    const value = r[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  return {
    calls: pick('calls'),
    promptTokens: pick('promptTokens'),
    completionTokens: pick('completionTokens'),
    totalTokens: pick('totalTokens'),
    knownTokenCalls: pick('knownTokenCalls'),
  }
}

// ---------------------------------------------------------------------------
// FR-4.8-03 / NFR-06：对局详情的用量摘要（按选手 + 按用途）
// ---------------------------------------------------------------------------

export type MatchUsageDigest = {
  matchId: string
  byAgent: Array<{ agentId: string | null; displayName: string | null } & UsageTotals>
  byPurpose: Array<{ purpose: string } & UsageTotals>
  totals: UsageTotals
}

/** 某对局的用量摘要：按选手聚合（含无主调用）+ 按用途聚合 + 总计。 */
export async function getMatchUsageDigest(dbh: DB, matchId: string): Promise<MatchUsageDigest> {
  const filter = { matchId }

  const byAgent = await dbh
    .select({ agentId: llmUsage.agentId, displayName: agents.displayName, ...usageSums })
    .from(llmUsage)
    .leftJoin(agents, eq(agents.id, llmUsage.agentId))
    .where(usageConditions(filter))
    .groupBy(llmUsage.agentId)
    .orderBy(desc(totalTokensExpr), desc(usageSums.calls), asc(llmUsage.agentId))

  const byPurpose = await dbh
    .select({ purpose: llmUsage.purpose, ...usageSums })
    .from(llmUsage)
    .where(usageConditions(filter))
    .groupBy(llmUsage.purpose)
    .orderBy(asc(llmUsage.purpose))

  const totalRows = await dbh.select(usageSums).from(llmUsage).where(usageConditions(filter))

  return {
    matchId,
    byAgent: byAgent.map((row) => ({ agentId: row.agentId, displayName: row.displayName, ...normalizeTotals(row) })),
    byPurpose: byPurpose.map((row) => ({ purpose: row.purpose, ...normalizeTotals(row) })),
    totals: normalizeTotals(totalRows[0]),
  }
}
