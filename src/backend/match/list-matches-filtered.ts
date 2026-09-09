// FR-4.6-04 对局历史过滤检索：GET /api/matches 与大厅「最近对局」共用的
// 查询层——按游戏品类 / 状态 / 关键词（对局 id + 参赛 Agent 名）过滤。
//
// URL 参数解析（parseMatchListFilter）与行过滤谓词（matchListRowMatches）
// 拆成纯函数，供 API route、大厅页与单元测试共用。

import { and, asc, desc, eq, exists, inArray, like, or } from 'drizzle-orm'
import { agents, gameEvents, matches, matchParticipants } from '@/platform/db/schema.sqlite'
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

export const MATCH_LIST_GAME_TYPES = ['poker', 'werewolf', 'avalon'] as const
export type MatchListGameType = (typeof MATCH_LIST_GAME_TYPES)[number]

export type MatchListFilter = {
  gameType?: MatchListGameType
  status?: MatchListStatus
  /** 关键词：匹配对局 id 或参赛 Agent 名（大小写不敏感）。 */
  q?: string
  limit?: number
}

/** 直播卡片阶段进度文案的数据源（自最近阶段事件派生的机械量）。 */
export type PhaseSummary = { handNumber: number; day: number; phase: string }

export type MatchListItem = {
  match: MatchRow
  participants: Array<{
    agentId: string
    displayName: string | null
    avatarEmoji: string | null
    seatIndex: number
  }>
  /** running 对局的阶段摘要（自事件流最近一条 phaseEntered / hand-started 派生；其余状态为 null）。 */
  phaseSummary: PhaseSummary | null
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
    if (!(MATCH_LIST_GAME_TYPES as readonly string[]).includes(gameType)) {
      throw new MatchListFilterError(`gameType 仅支持 ${MATCH_LIST_GAME_TYPES.join(' / ')}，收到：${gameType}`)
    }
    filter.gameType = gameType as MatchListGameType
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
 * 单条阶段事件（game_events 行的完整事件 JSON）→ PhaseSummary。
 * 支持两种锚：poker 的 hand-started（handNumber）与 werewolf/avalon 的
 * phaseEntered（day + phase）。解析失败返回 null。
 */
export function phaseSummaryFromEvent(
  gameType: string,
  eventJson: unknown,
): PhaseSummary | null {
  if (typeof eventJson === 'string') {
    try {
      eventJson = JSON.parse(eventJson)
    } catch {
      return null
    }
  }
  if (typeof eventJson !== 'object' || eventJson === null) return null
  const event = eventJson as { kind?: unknown; day?: unknown; payload?: unknown }
  const payload =
    typeof event.payload === 'object' && event.payload !== null ? (event.payload as Record<string, unknown>) : {}
  const kind = typeof event.kind === 'string' ? event.kind : ''
  if (kind.endsWith('hand-started')) {
    const hand = typeof payload.handNumber === 'number' ? payload.handNumber : 0
    return { handNumber: hand, day: hand, phase: typeof payload.phase === 'string' ? payload.phase : '' }
  }
  if (kind.endsWith('phaseEntered')) {
    const day = typeof event.day === 'number' ? event.day : 0
    const phase = typeof payload.phase === 'string' ? payload.phase : ''
    return { handNumber: 0, day, phase }
  }
  void gameType
  return null
}

/**
 * running 对局的阶段摘要：取该对局事件流中最近一条 phaseEntered /
 * hand-started（poker）。单机规模下整批拉取后在 JS 侧取各组最新。
 */
async function phaseSummariesByMatch(runningIds: string[]): Promise<Map<string, PhaseSummary>> {
  const out = new Map<string, PhaseSummary>()
  if (runningIds.length === 0) return out
  const rows = await db
    .select({ matchId: gameEvents.matchId, seq: gameEvents.seq, kind: gameEvents.kind, payload: gameEvents.payload })
    .from(gameEvents)
    .where(
      and(
        inArray(gameEvents.matchId, runningIds),
        or(like(gameEvents.kind, '%:v2:phaseEntered'), like(gameEvents.kind, '%:v2:hand-started')),
      ),
    )
  const latest = new Map<string, { seq: number; gameType: string; payload: unknown }>()
  for (const row of rows) {
    const seen = latest.get(row.matchId)
    if (!seen || row.seq > seen.seq) {
      latest.set(row.matchId, { seq: row.seq, gameType: '', payload: row.payload })
    }
  }
  for (const [matchId, row] of latest) {
    const summary = phaseSummaryFromEvent('', row.payload)
    if (summary) out.set(matchId, summary)
  }
  return out
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

  const phaseSummaries = await phaseSummariesByMatch(rows.filter((row) => row.status === 'running').map((row) => row.id))

  return rows.map((match) => ({
    match,
    participants: byMatch.get(match.id) ?? [],
    phaseSummary: phaseSummaries.get(match.id) ?? null,
  }))
}
