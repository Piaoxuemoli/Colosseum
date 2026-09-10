/**
 * FR-4.9-01 ELO 天梯查询层：结算钩子（单局增量）、全量幂等重建、天梯读取。
 *
 * 胜负判定复用 queries/stats 的 rankingRowOutcome（口径同源，PRD 口径 6）；
 * 评分数学在 platform/stats/elo 纯函数。平局（阵营游戏全员同分 / 无有效
 * winnerFaction）与不可解析局跳过，不产生任何变动（口径 5）。
 */

import { and, asc, eq, inArray } from 'drizzle-orm'
import { agents, eloRatings, matches } from '@/platform/db/schema.sqlite'
import type { DB } from '@/platform/db/client'
import { applyEloMatch, initialEloState, type EloPlayerInput, type EloState } from '@/platform/stats/elo'
import { parseRankingRows, rankingRowOutcome } from './stats'

/** 单行 completed 对局 → ELO 输入（胜负同源判定）；不可判定返回 null。 */
function eloPlayersForMatch(
  gameType: string,
  winnerFaction: string | null,
  finalRanking: unknown,
): EloPlayerInput[] | null {
  const rows = parseRankingRows(finalRanking)
  if (rows.length < 2) return null
  const players: EloPlayerInput[] = []
  let wins = 0
  for (const row of rows) {
    if (typeof row.agentId !== 'string') continue
    const outcome = rankingRowOutcome(gameType, winnerFaction, row)
    if (outcome.win) wins += 1
    players.push({ agentId: row.agentId, won: outcome.win })
  }
  if (players.length < 2) return null
  // 平局跳过：无胜者或全胜（阵营游戏 tie 时全员 score=1 → 全员 won）。
  if (wins === 0 || wins === players.length) return null
  return players
}

async function loadEloStates(
  dbh: DB,
  gameType: string,
  agentIds: string[],
): Promise<Map<string, EloState>> {
  const out = new Map<string, EloState>()
  if (agentIds.length === 0) return out
  const rows = await dbh
    .select()
    .from(eloRatings)
    .where(and(eq(eloRatings.gameType, gameType), inArray(eloRatings.agentId, agentIds)))
  for (const row of rows) {
    out.set(row.agentId, {
      rating: row.rating,
      matchesPlayed: row.matchesPlayed,
      wins: row.wins,
      losses: row.losses,
      lastDelta: row.lastDelta,
    })
  }
  return out
}

async function persistEloStates(dbh: DB, gameType: string, states: Map<string, EloState>): Promise<void> {
  for (const [agentId, state] of states) {
    await dbh
      .insert(eloRatings)
      .values({
        agentId,
        gameType,
        rating: state.rating,
        matchesPlayed: state.matchesPlayed,
        wins: state.wins,
        losses: state.losses,
        lastDelta: state.lastDelta,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [eloRatings.agentId, eloRatings.gameType],
        set: {
          rating: state.rating,
          matchesPlayed: state.matchesPlayed,
          wins: state.wins,
          losses: state.losses,
          lastDelta: state.lastDelta,
          updatedAt: new Date(),
        },
      })
  }
}

/**
 * 结算钩子：一场 completed 对局的增量 ELO 更新（对局结算主流程的非阻塞
 * 伴生步骤——失败由调用方捕获记日志，不影响 finalRanking 落库）。
 * 返回本次更新的选手数（跳过时 0）。
 */
export async function applyEloForMatch(
  dbh: DB,
  match: { id: string; gameType: string; winnerFaction: string | null; finalRanking: unknown; status: string },
): Promise<number> {
  if (match.status !== 'completed') return 0
  const players = eloPlayersForMatch(match.gameType, match.winnerFaction, match.finalRanking)
  if (!players) return 0
  const states = await loadEloStates(dbh, match.gameType, players.map((player) => player.agentId))
  const applied = applyEloMatch(players, states)
  await persistEloStates(dbh, match.gameType, applied.states)
  return players.length
}

export type EloLadderRow = EloState & {
  agentId: string
  displayName: string
  avatarEmoji: string | null
  gameType: string
}

/**
 * 全量幂等重建（回填端点）：清空后按 startedAt 升序重放全部 completed
 * 对局。单用户部署规模下全量在内存中重放，事务外执行（重建期间读到的
 * 天梯可能短暂为旧值，可接受——下一次重建或新对局结算后收敛）。
 */
export async function rebuildEloFromHistory(dbh: DB): Promise<{ matchesApplied: number; players: number }> {
  const rows = await dbh
    .select({
      id: matches.id,
      gameType: matches.gameType,
      winnerFaction: matches.winnerFaction,
      finalRanking: matches.finalRanking,
    })
    .from(matches)
    .where(eq(matches.status, 'completed'))
    .orderBy(asc(matches.startedAt), asc(matches.id))

  await dbh.delete(eloRatings)

  // 按 gameType 分列重放（口径 1）。
  const ladders = new Map<string, Map<string, EloState>>()
  let matchesApplied = 0
  for (const row of rows) {
    const players = eloPlayersForMatch(row.gameType, row.winnerFaction, row.finalRanking)
    if (!players) continue
    const ladder = ladders.get(row.gameType) ?? new Map<string, EloState>()
    ladders.set(row.gameType, applyEloMatch(players, ladder).states)
    matchesApplied += 1
  }
  let playerRows = 0
  for (const [gameType, states] of ladders) {
    await persistEloStates(dbh, gameType, states)
    playerRows += states.size
  }
  return { matchesApplied, players: playerRows }
}

/** 天梯读取（按品类；评分降序 → 场次降序 → 显示名）。 */
export async function getEloLadder(dbh: DB, gameType: string): Promise<EloLadderRow[]> {
  const rows = await dbh
    .select({
      agentId: eloRatings.agentId,
      gameType: eloRatings.gameType,
      rating: eloRatings.rating,
      matchesPlayed: eloRatings.matchesPlayed,
      wins: eloRatings.wins,
      losses: eloRatings.losses,
      lastDelta: eloRatings.lastDelta,
      displayName: agents.displayName,
      avatarEmoji: agents.avatarEmoji,
    })
    .from(eloRatings)
    .leftJoin(agents, eq(agents.id, eloRatings.agentId))
    .where(eq(eloRatings.gameType, gameType))
    .orderBy(asc(eloRatings.rating))

  return rows
    .map((row) => ({
      agentId: row.agentId,
      gameType: row.gameType,
      rating: row.rating,
      matchesPlayed: row.matchesPlayed,
      wins: row.wins,
      losses: row.losses,
      lastDelta: row.lastDelta,
      displayName: row.displayName ?? row.agentId,
      avatarEmoji: row.avatarEmoji,
    }))
    .reverse()
}

export { initialEloState }
