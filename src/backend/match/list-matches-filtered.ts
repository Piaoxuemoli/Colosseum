// FR-4.6-04 对局历史过滤检索：GET /api/matches 与大厅「最近对局」共用的
// 查询层——按游戏品类 / 状态 / 关键词（对局 id + 参赛 Agent 名）过滤。
//
// URL 参数解析（parseMatchListFilter）与行过滤谓词（matchListRowMatches）
// 拆成纯函数，供 API route、大厅页与单元测试共用。

import { and, asc, desc, eq, exists, inArray, like, or } from 'drizzle-orm'
import { agents, matches, matchParticipants } from '@/platform/db/schema.sqlite'
import { db } from '@/platform/db/client'
import type { MatchRow } from '@/platform/db/queries/matches'

export const MATCH_LIST_STATUSES = [
  'pending',
  'running',
  'completed',
  'errored',
  'aborted_by_errors',
] as const
export type MatchListStatus = (typeof MATCH_LIST_STATUSES)[number]

export type MatchListFilter = {
  gameType?: 'poker' | 'werewolf'
  status?: MatchListStatus
  /** 关键词：匹配对局 id 或参赛 Agent 展示名（大小写不敏感）。 */
  q?: string
  limit?: number
}

export type MatchListItem = {
  match: MatchRow
  participants: Array<{
    agentId: string
    displayName: string | null
    avatarEmoji: string | null
    seatIndex: number
  }>
}

export type MatchListFilterInput = {
  gameType?: string | null
  status?: string | null
  q?: string | null
  limit?: string | number | null
}

export class MatchListFilterError extends Error {}

/**
 * URL/请求参数 → MatchListFilter。非法 gameType / status / limit 抛
 * MatchListFilterError（调用方回 400）；空串与空白视为「不过滤」。
 */
export function parseMatchListFilter(input: MatchListFilterInput): MatchListFilter {
  const filter: MatchListFilter = {}

  const gameType = typeof input.gameType === 'string' ? input.gameType.trim() : ''
  if (gameType) {
    if (gameType !== 'poker' && gameType !== 'werewolf') {
      throw new MatchListFilterError(`gameType 仅支持 poker / werewolf，收到：${gameType}`)
    }
    filter.gameType = gameType
  }

  const status = typeof input.status === 'string' ? input.status.trim() : ''
  if (status) {
    if (!MATCH_LIST_STATUSES.includes(status as MatchListStatus)) {
      throw new MatchListFilterError(`status 仅支持 ${MATCH_LIST_STATUSES.join(' / ')}，收到：${status}`)
    }
    filter.status = status as MatchListStatus
  }

  const q = typeof input.q === 'string' ? input.q.trim() : ''
  if (q) filter.q = q

  if (input.limit !== undefined && input.limit !== null && input.limit !== '') {
    const limit = Number(input.limit)
    if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
      throw new MatchListFilterError('limit 须为 1-200 的整数')
    }
    filter.limit = limit
  }

  return filter
}

/** LIKE 模式转义：用户输入中的 % _ 不作为通配符。 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * 单行过滤谓词（纯函数，供测试）：gameType/status 精确匹配，q 对对局 id
 * 与参赛 Agent 名做大小写不敏感的包含匹配。
 */
export function matchListRowMatches(
  match: { id: string; gameType: string; status: string },
  participantNames: string[],
  filter: MatchListFilter,
): boolean {
  if (filter.gameType && match.gameType !== filter.gameType) return false
  if (filter.status && match.status !== filter.status) return false
  if (filter.q) {
    const needle = filter.q.toLowerCase()
    const hit =
      match.id.toLowerCase().includes(needle) ||
      participantNames.some((name) => name.toLowerCase().includes(needle))
    if (!hit) return false
  }
  return true
}

/**
 * 过滤后的对局列表（含参赛 Agent 摘要，供排名摘要/名称检索渲染）。
 * gameType/status/关键词命中在 SQL 侧完成；单用户部署规模下参赛者
 * 摘要按候选 id 批量补齐。
 */
export async function listMatchesFiltered(filter: MatchListFilter = {}): Promise<MatchListItem[]> {
  const conditions = []
  if (filter.gameType) conditions.push(eq(matches.gameType, filter.gameType))
  if (filter.status) conditions.push(eq(matches.status, filter.status))
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q)}%`
    const agentNameHit = db
      .select({ one: agents.id })
      .from(matchParticipants)
      .innerJoin(agents, eq(matchParticipants.agentId, agents.id))
      .where(and(eq(matchParticipants.matchId, matches.id), like(agents.displayName, pattern)))
      .limit(1)
    conditions.push(or(like(matches.id, pattern), exists(agentNameHit)))
  }

  const rows = await db
    .select()
    .from(matches)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(matches.startedAt), asc(matches.id))
    .limit(filter.limit ?? 50)

  if (rows.length === 0) return []

  const participantRows = await db
    .select({
      matchId: matchParticipants.matchId,
      agentId: matchParticipants.agentId,
      seatIndex: matchParticipants.seatIndex,
      displayName: agents.displayName,
      avatarEmoji: agents.avatarEmoji,
    })
    .from(matchParticipants)
    .leftJoin(agents, eq(matchParticipants.agentId, agents.id))
    .where(inArray(matchParticipants.matchId, rows.map((row) => row.id)))
    .orderBy(asc(matchParticipants.seatIndex))

  const byMatch = new Map<string, MatchListItem['participants']>()
  for (const row of participantRows) {
    const list = byMatch.get(row.matchId) ?? []
    list.push({
      agentId: row.agentId,
      displayName: row.displayName,
      avatarEmoji: row.avatarEmoji,
      seatIndex: row.seatIndex,
    })
    byMatch.set(row.matchId, list)
  }

  return rows.map((match) => ({ match, participants: byMatch.get(match.id) ?? [] }))
}
