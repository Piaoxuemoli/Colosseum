/**
 * FR-4.7-02 赛后解说（R3-4）：基于本局真实事件流的 LLM 终局解说，
 * 「不虚构」为硬约束。本模块是纯逻辑层（无 IO），供 API route 组装：
 *
 *   1. buildCommentaryDigest —— 从留存事件流（v2 信封，含终局后全部
 *      可见的 delayed-public / 受限事实）+ matches.finalRanking 提取
 *      结构化「关键时刻」清单，作为 LLM 的唯一事实素材；
 *   2. buildCommentaryPrompt —— 生成要求引用 seq、禁止编造的提示词；
 *   3. validateCommentaryResponse —— 服务端校验：每条 highlight 的 seq
 *      必须真实存在于本局事件流，否则丢弃该条；过半无效则整体拒绝；
 *   4. buildCommentaryEvent —— 校验后的解说落成 `match/commentary`
 *      公共事件（FR-4.8-02 留存，回放/结算从事件流读取最新一条）。
 *
 * 密钥口径（FR-4.1 / NFR-07）：解说由客户端触发，apiKey 随请求体传入、
 * 仅用于本次 LLM 调用——本模块不接触任何密钥，也永不落库。
 */

import { newEventId } from '@/platform/core/ids'
import type { GameEvent, GameType } from '@/platform/core/types'

// ---------------------------------------------------------------------------
// 契约类型（API 响应与 match/commentary 事件 payload 共用）
// ---------------------------------------------------------------------------

export type CommentaryHighlight = {
  /** 被引用的时刻 = 本局事件流中真实存在的事件 seq（校验强制）。 */
  seq: number
  title: string
  text: string
}

export type CommentaryMvp = {
  agentId: string
  reason: string
}

export type CommentaryPayload = {
  headline: string
  summary: string
  highlights: CommentaryHighlight[]
  mvp?: CommentaryMvp
}

/** 单条关键时刻（digest 条目；description 是给 LLM 的事实句）。 */
export type CommentaryKeyMoment = {
  seq: number
  /** DB 信封 kind（如 `poker:v2:pot-awarded`），供排障对照。 */
  kind: string
  /** 中文短标签：大底池 / 淘汰 / 盲注升级 / 死讯 / 放逐 / 终局揭示… */
  label: string
  description: string
}

export type CommentaryDigest = {
  gameType: GameType
  matchId: string
  /** 参赛者 agentId → 显示名（缺省回落到 id）。 */
  agentNames: Record<string, string>
  /** 参赛者全集（mvp.agentId 合法域）。 */
  rosterAgentIds: string[]
  keyMoments: CommentaryKeyMoment[]
  /** matches.finalRanking 的防御性读取形态（不可解析 → null）。 */
  ranking: Array<{ agentId: string; rank: number; score: number }> | null
  winnerFaction: string | null
}

export type CommentarySource = {
  model: string
  providerHost: string
  createdAt: string
}

/** digest / prompt / 校验的规模上限（防长局 prompt 爆炸）。 */
export const MAX_KEY_MOMENTS = 60
/** 扑克「大底池」保留的手数（按本手派彩总额排序取前 N）。 */
export const POKER_BIG_POT_HANDS = 5
/** 狼人杀遗言 / 查验类时刻的保留条数（按时间序取前 N）。 */
export const WEREWOLF_MINOR_MOMENTS = 4

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

/** baseUrl → host（解析失败时原样返回，供展示与留存溯源）。 */
export function baseUrlHost(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

// ---------------------------------------------------------------------------
// 终局排名读取（matches.finalRanking JSON 的防御性解析）
// ---------------------------------------------------------------------------

function parseFinalRanking(value: unknown): {
  ranking: Array<{ agentId: string; rank: number; score: number }>
  winnerFaction: string | null
} | null {
  const raw = asRecord(value)
  if (!raw) return null
  const rankingRaw = Array.isArray(raw.ranking) ? raw.ranking.flatMap((item) => (asRecord(item) ? [item] : [])) : []
  const ranking = rankingRaw.flatMap((item) => {
    const agentId = stringOr(item.agentId)
    const rank = numberOr(item.rank, 0)
    if (!agentId || rank <= 0) return []
    return [{ agentId, rank, score: numberOr(item.score, 0) }]
  })
  if (ranking.length === 0) return null
  return { ranking, winnerFaction: typeof raw.winnerFaction === 'string' ? raw.winnerFaction : null }
}

// ---------------------------------------------------------------------------
// 扑克关键时刻（PFR-4xx 事件契约：pot-awarded / player-eliminated /
// blind-level-raised / run-out-started / action-made(allIn) / match-finished）
// ---------------------------------------------------------------------------

function pokerKeyMoments(events: GameEvent[], nameOf: (id: string) => string): CommentaryKeyMoment[] {
  type PotAward = { seq: number; hand: number; amount: number; potIndex: number; winners: string[] }
  const potAwards: PotAward[] = []
  const allInHands = new Map<number, { seq: number; seats: string[] }>()
  const runOutHands = new Set<number>()
  const moments: CommentaryKeyMoment[] = []

  for (const event of events) {
    const payload = asRecord(event.payload) ?? {}
    switch (event.kind) {
      case 'poker:v2:pot-awarded': {
        const hand = numberOr(payload.hand, 0)
        const winnersRaw = Array.isArray(payload.winners) ? payload.winners.flatMap((w) => (asRecord(w) ? [w] : [])) : []
        potAwards.push({
          seq: event.seq,
          hand,
          amount: numberOr(payload.amount, 0),
          potIndex: numberOr(payload.potIndex, 0),
          winners: winnersRaw.map((w) => stringOr(w.seatId)).filter(Boolean),
        })
        break
      }
      case 'poker:v2:action-made': {
        const action = asRecord(payload.action)
        if (action && stringOr(action.type) === 'allIn') {
          const hand = numberOr(payload.hand, 0)
          const seatId = stringOr(payload.seatId)
          const existing = allInHands.get(hand)
          if (existing) {
            if (seatId && !existing.seats.includes(seatId)) existing.seats.push(seatId)
          } else if (event.seq) {
            allInHands.set(hand, { seq: event.seq, seats: seatId ? [seatId] : [] })
          }
        }
        break
      }
      case 'poker:v2:run-out-started': {
        runOutHands.add(numberOr(payload.hand, 0))
        break
      }
      default:
        break
    }
  }

  // 大底池：按手聚合派彩总额，取总额最大的前 POKER_BIG_POT_HANDS 手。
  const totalsByHand = new Map<number, number>()
  for (const award of potAwards) {
    totalsByHand.set(award.hand, (totalsByHand.get(award.hand) ?? 0) + award.amount)
  }
  const bigHands = new Set(
    [...totalsByHand.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, POKER_BIG_POT_HANDS)
      .map(([hand]) => hand),
  )

  // 与事件流同序输出，保证 prompt 内时刻按真实时间排列。
  for (const event of events) {
    const payload = asRecord(event.payload) ?? {}
    switch (event.kind) {
      case 'poker:v2:blind-level-raised': {
        const blinds = asRecord(payload.blinds)
        moments.push({
          seq: event.seq,
          kind: event.kind,
          label: '盲注升级',
          description: `盲注升至 L${numberOr(payload.level, 0)}：SB/BB ${numberOr(blinds?.sb, 0)}/${numberOr(blinds?.bb, 0)}`,
        })
        break
      }
      case 'poker:v2:run-out-started': {
        const hand = numberOr(payload.hand, 0)
        moments.push({
          seq: event.seq,
          kind: event.kind,
          label: 'run-out',
          description: `第 ${hand} 手全员 all-in，进入 run-out 依次发完公共牌`,
        })
        break
      }
      case 'poker:v2:action-made': {
        const action = asRecord(payload.action)
        const hand = numberOr(payload.hand, 0)
        if (action && stringOr(action.type) === 'allIn') {
          const first = allInHands.get(hand)
          if (first && first.seq === event.seq) {
            const seats = first.seats.map(nameOf).join('、')
            moments.push({
              seq: event.seq,
              kind: event.kind,
              label: '全下',
              description: `第 ${hand} 手${seats ? `${seats}` : '有选手'}全下（all-in）`,
            })
          }
        }
        break
      }
      case 'poker:v2:pot-awarded': {
        const hand = numberOr(payload.hand, 0)
        if (!bigHands.has(hand)) break
        const amount = numberOr(payload.amount, 0)
        const winnersRaw = Array.isArray(payload.winners) ? payload.winners.flatMap((w) => (asRecord(w) ? [w] : [])) : []
        const winnerText = winnersRaw.map((w) => nameOf(stringOr(w.seatId))).join('、')
        moments.push({
          seq: event.seq,
          kind: event.kind,
          label: '大底池',
          description: `第 ${hand} 手${numberOr(payload.potIndex, 0) > 0 ? `主池#${numberOr(payload.potIndex, 0)}` : '底池'}派彩 ${amount}，赢家：${winnerText || '未知'}${runOutHands.has(hand) ? '（run-out 摊牌）' : ''}`,
        })
        break
      }
      case 'poker:v2:player-eliminated': {
        const seatId = stringOr(payload.seatId)
        moments.push({
          seq: event.seq,
          kind: event.kind,
          label: '淘汰',
          description: `${nameOf(seatId)}筹码归零出局，最终第 ${numberOr(payload.rank, 0)} 名`,
        })
        break
      }
      case 'poker:v2:match-finished': {
        moments.push({
          seq: event.seq,
          kind: event.kind,
          label: '终局',
          description: `对局结束（${stringOr(payload.reason, 'unknown')}），排名见终局排名清单`,
        })
        break
      }
      default:
        break
    }
  }

  return moments
}

// ---------------------------------------------------------------------------
// 狼人杀关键时刻（WFR-5xx 事件契约：deathsAnnounced / voteResult /
// wolfKillAgreed / hunterShot / seerChecked / lastWords / gameEnded）
// ---------------------------------------------------------------------------

function werewolfKeyMoments(events: GameEvent[], nameOf: (id: string) => string): CommentaryKeyMoment[] {
  const moments: CommentaryKeyMoment[] = []
  let lastWordsCount = 0
  let seerTotal = 0

  for (const event of events) {
    const payload = asRecord(event.payload) ?? {}
    // engine2 信封 payload 内嵌事件本体：外层平铺 + payload 字段（见
    // v2EventRow：raw 逐字段平铺）。两处都查，容错不同落库代次。
    const inner = asRecord(payload.payload) ?? payload
    const day = numberOr(payload.day, 0)

    switch (event.kind) {
      case 'werewolf:v2:deathsAnnounced': {
        const kind = stringOr(inner.kind, 'single')
        const kindText = kind === 'peaceful' ? '平安夜（无人死亡）' : kind === 'double' ? '双死' : '单死'
        const seats = Array.isArray(inner.seatNumbers) ? inner.seatNumbers.filter((n) => typeof n === 'number') : []
        const roles = Array.isArray(inner.roles)
          ? inner.roles.filter((r): r is string => typeof r === 'string').map((r) => `（身份:${r}）`).join('')
          : ''
        moments.push({
          seq: event.seq,
          kind: event.kind,
          label: '死讯公告',
          description: `第 ${day} 天天亮公告：${kindText}${seats.length > 0 ? `，${seats.length} 号位` : ''}${roles}`,
        })
        break
      }
      case 'werewolf:v2:wolfKillAgreed': {
        const targetId = typeof inner.targetId === 'string' ? inner.targetId : null
        moments.push({
          seq: event.seq,
          kind: event.kind,
          label: '狼队刀口',
          description: `夜间狼队商定刀口：${targetId ? nameOf(targetId) : '空刀（无人出局）'}`,
        })
        break
      }
      case 'werewolf:v2:voteResult': {
        const round = stringOr(inner.round, 'main') === 'pk' ? 'PK 轮' : '主轮'
        const outcome = stringOr(inner.outcome, '')
        const exiledId = typeof inner.exiledId === 'string' ? inner.exiledId : null
        const outcomeText =
          outcome === 'exile'
            ? `放逐${exiledId ? ` ${nameOf(exiledId)}` : ''}`
            : outcome === 'tie-pk'
              ? '平票进入 PK'
              : outcome === 'no-exile-after-pk'
                ? 'PK 再平票，无人出局'
                : outcome === 'no-majority'
                  ? '无多数票，无人出局'
                  : '无人出局'
        moments.push({
          seq: event.seq,
          kind: event.kind,
          label: '投票结果',
          description: `第 ${day} 天${round}投票：${outcomeText}`,
        })
        break
      }
      case 'werewolf:v2:hunterShot': {
        const hunterId = stringOr(inner.hunterId)
        const targetId = stringOr(inner.targetId)
        moments.push({
          seq: event.seq,
          kind: event.kind,
          label: '猎人开枪',
          description: `${nameOf(hunterId)}翻牌开枪带走 ${nameOf(targetId)}`,
        })
        break
      }
      case 'werewolf:v2:lastWords': {
        if (lastWordsCount >= WEREWOLF_MINOR_MOMENTS) break
        const playerId = stringOr(inner.playerId)
        const content = stringOr(inner.content)
        if (!content) break
        lastWordsCount += 1
        moments.push({
          seq: event.seq,
          kind: event.kind,
          label: '遗言',
          description: `${nameOf(playerId)}遗言：「${truncate(content, 60)}」`,
        })
        break
      }
      case 'werewolf:v2:seerChecked': {
        seerTotal += 1
        break
      }
      case 'werewolf:v2:gameEnded': {
        const winner = stringOr(inner.winner, 'tie')
        const winnerText = winner === 'wolves' ? '狼人阵营' : winner === 'good' ? '好人阵营' : '平局'
        const reveal = Array.isArray(inner.reveal) ? inner.reveal.flatMap((r) => (asRecord(r) ? [r] : [])) : []
        const rolesText = reveal
          .slice(0, 12)
          .map((r) => `${nameOf(stringOr(r.playerId))}=${stringOr(r.role, '?')}${asRecord(r.death) ? '†' : ''}`)
          .join('、')
        moments.push({
          seq: event.seq,
          kind: event.kind,
          label: '终局揭示',
          description: `终局：${winnerText}获胜（${stringOr(inner.basis, '')}）；全桌身份揭示：${rolesText}`,
        })
        break
      }
      default:
        break
    }
  }

  // 查验事实附在流尾（最近几次最有信息量），避免长局 prompt 膨胀。
  if (seerTotal > 0) {
    const seerEvents = events.filter((event) => event.kind === 'werewolf:v2:seerChecked').slice(-WEREWOLF_MINOR_MOMENTS)
    for (const event of seerEvents) {
      const payload = asRecord(event.payload) ?? {}
      const inner = asRecord(payload.payload) ?? payload
      const targetId = stringOr(inner.targetId)
      const result = stringOr(inner.result, 'good') === 'werewolf' ? '狼人' : '好人'
      moments.push({
        seq: event.seq,
        kind: event.kind,
        label: '查验',
        description: `预言家查验 ${nameOf(targetId)}：${result}`,
      })
    }
  }

  return moments.sort((a, b) => a.seq - b.seq).slice(0, MAX_KEY_MOMENTS)
}

// ---------------------------------------------------------------------------
// Digest 构造（纯函数）
// ---------------------------------------------------------------------------

export function buildCommentaryDigest(input: {
  matchId: string
  gameType: GameType
  events: GameEvent[]
  finalRanking?: Record<string, unknown> | null
  agentNames?: Record<string, string>
}): CommentaryDigest {
  const agentNames: Record<string, string> = { ...(input.agentNames ?? {}) }
  const nameOf = (id: string): string => agentNames[id] || id

  // 名册兜底：从事件 actor / 扑克 seatIds / 终局揭示里发现参赛者 id。
  const discovered = new Set<string>(Object.keys(agentNames))
  for (const event of input.events) {
    if (event.actorAgentId) discovered.add(event.actorAgentId)
    const payload = asRecord(event.payload) ?? {}
    if (input.gameType === 'poker') {
      if (event.kind === 'poker:v2:match-config' && Array.isArray(payload.seatIds)) {
        for (const seat of payload.seatIds) if (typeof seat === 'string') discovered.add(seat)
      }
      const seatId = stringOr(payload.seatId)
      if (seatId && event.kind.startsWith('poker:v2:')) discovered.add(seatId)
    }
    if (input.gameType === 'werewolf' && event.kind === 'werewolf:v2:gameEnded') {
      const inner = asRecord(payload.payload) ?? payload
      const reveal = Array.isArray(inner.reveal) ? inner.reveal.flatMap((r) => (asRecord(r) ? [r] : [])) : []
      for (const entry of reveal) {
        const playerId = stringOr(entry.playerId)
        if (playerId) discovered.add(playerId)
      }
    }
  }
  const parsedRanking = parseFinalRanking(input.finalRanking)
  if (parsedRanking) for (const entry of parsedRanking.ranking) discovered.add(entry.agentId)

  const keyMoments =
    input.gameType === 'poker'
      ? pokerKeyMoments(input.events, nameOf).slice(0, MAX_KEY_MOMENTS)
      : werewolfKeyMoments(input.events, nameOf)

  return {
    gameType: input.gameType,
    matchId: input.matchId,
    agentNames,
    rosterAgentIds: [...discovered],
    keyMoments,
    ranking: parsedRanking?.ranking ?? null,
    winnerFaction: parsedRanking?.winnerFaction ?? null,
  }
}

// ---------------------------------------------------------------------------
// Prompt 构造（纯函数）
// ---------------------------------------------------------------------------

export function buildCommentaryPrompt(digest: CommentaryDigest): { systemMessage: string; userMessage: string } {
  const gameLabel = digest.gameType === 'poker' ? '德州扑克' : '狼人杀'
  const roster = digest.rosterAgentIds.map((id) => `${digest.agentNames[id] || id}(${id})`).join('、')
  const ranking = digest.ranking
    ? digest.ranking
        .map(
          (entry) =>
            `#${entry.rank} ${digest.agentNames[entry.agentId] || entry.agentId}${digest.gameType === 'poker' ? `（${entry.score} 筹码）` : ''}`,
        )
        .join('；')
    : '（终局排名数据缺失——解说中不要给出具体名次）'
  const moments = digest.keyMoments
    .map((moment) => `#seq=${moment.seq} [${moment.label}] ${moment.description}`)
    .join('\n')

  const systemMessage = [
    `你是一位${gameLabel}电竞解说员，正在为一场已结束的 AI 对局撰写赛后解说。`,
    '',
    '铁律（违反即作废）：',
    '1. 只能引用「关键时刻清单」中列出的事实（以 #seq= 编号）；每条亮点必须给出对应的 seq，且该 seq 必须来自清单。',
    '2. 严禁编造清单之外的事件、数字、身份、对话或名次；不得推测未经证实的动机为事实（可以标注为「看起来/疑似」）。',
    '3. 全部使用中文，语气专业、有感染力，但不夸张失实。',
    '',
    '输出格式：先简要思考，然后把最终结果作为 JSON 放入 <action></action> 标签：',
    '<action>{"headline":"一句不超过 30 字的标题","summary":"100-200 字总评","highlights":[{"seq":清单里的编号,"title":"时刻标题","text":"两句以内的解说"}],"mvp":{"agentId":"选手id","reason":"理由"}}</action>',
    '- highlights 3-6 条，按时间顺序；seq 必须逐字取自清单中的编号。',
    '- mvp 的 agentId 必须是名单中的选手 id；不确定时省略 mvp 字段。',
  ].join('\n')

  const userMessage = [
    `【对局】${gameLabel} ${digest.matchId}`,
    `【参赛选手】${roster}`,
    `【终局排名】${ranking}`,
    digest.winnerFaction ? `【获胜方】${digest.winnerFaction}` : '',
    '',
    '【关键时刻清单】（唯一事实来源，#seq= 为事件编号）',
    moments || '（无关键事件——请基于终局排名做总结，highlights 可以为空数组外的最少 1 条，引用终局 seq；若清单整体为空则省略 highlights 字段）',
    '',
    '请基于以上真实数据生成赛后解说 JSON（放入 <action></action>）。',
  ]
    .filter((line) => line !== '')
    .join('\n')

  return { systemMessage, userMessage }
}

// ---------------------------------------------------------------------------
// 响应校验（纯函数；不虚构的强制执行点）
// ---------------------------------------------------------------------------

export type CommentaryValidation =
  | {
      ok: true
      commentary: CommentaryPayload
      /** 被丢弃的引用不存在 seq 的亮点条数（≤ 半数，其余保留）。 */
      droppedHighlights: number
      /** 被丢弃的具体 seq（供 422 提示与日志）。 */
      invalidSeqs: number[]
      /** mvp 不在名册而被丢弃。 */
      droppedMvp: boolean
    }
  | { ok: false; code: 'invalid_shape'; reason: string }
  | { ok: false; code: 'fabrication'; invalidSeqs: number[]; kept: number; dropped: number }

const HEADLINE_MAX = 120
const SUMMARY_MAX = 800
const TITLE_MAX = 80
const TEXT_MAX = 400
const HIGHLIGHTS_MAX = 12
const MVP_REASON_MAX = 300

function clampText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return truncate(trimmed, max)
}

/**
 * 校验 LLM 输出的解说 JSON：
 * - 形状：headline/summary/highlights 必填，逐条字段类型正确（超长截断）；
 * - grounding：highlight.seq 必须存在于本局事件流（events 序列集合），
 *   不存在的条目被丢弃；丢弃数 > 总数一半 → 整体拒绝（fabrication）；
 * - mvp.agentId 必须在 rosterAgentIds（缺省时从 events actor 推导），
 *   否则丢弃 mvp 而非拒绝（亮点才是硬约束）。
 */
export function validateCommentaryResponse(input: {
  raw: unknown
  events: GameEvent[]
  rosterAgentIds?: string[]
}): CommentaryValidation {
  const record = asRecord(input.raw)
  if (!record) return { ok: false, code: 'invalid_shape', reason: 'response is not a JSON object' }

  const headline = clampText(record.headline, HEADLINE_MAX)
  if (!headline) return { ok: false, code: 'invalid_shape', reason: 'headline missing or empty' }
  const summary = clampText(record.summary, SUMMARY_MAX)
  if (!summary) return { ok: false, code: 'invalid_shape', reason: 'summary missing or empty' }

  if (!Array.isArray(record.highlights) || record.highlights.length === 0) {
    return { ok: false, code: 'invalid_shape', reason: 'highlights missing or empty' }
  }
  if (record.highlights.length > HIGHLIGHTS_MAX) {
    return { ok: false, code: 'invalid_shape', reason: `too many highlights (>${HIGHLIGHTS_MAX})` }
  }

  const validSeqs = new Set(input.events.map((event) => event.seq))
  const highlights: CommentaryHighlight[] = []
  const invalidSeqs: number[] = []
  for (const rawHighlight of record.highlights) {
    const item = asRecord(rawHighlight)
    if (!item) return { ok: false, code: 'invalid_shape', reason: 'highlight entry is not an object' }
    const seq = typeof item.seq === 'number' && Number.isInteger(item.seq) ? item.seq : null
    const title = clampText(item.title, TITLE_MAX)
    const text = clampText(item.text, TEXT_MAX)
    if (seq === null || !title || !text) {
      return { ok: false, code: 'invalid_shape', reason: 'highlight missing seq/title/text' }
    }
    if (!validSeqs.has(seq)) {
      invalidSeqs.push(seq)
      continue
    }
    highlights.push({ seq, title, text })
  }

  const total = record.highlights.length
  const dropped = invalidSeqs.length
  if (dropped > total / 2) {
    return { ok: false, code: 'fabrication', invalidSeqs, kept: highlights.length, dropped }
  }

  const roster = new Set(
    input.rosterAgentIds ?? [...new Set(input.events.map((event) => event.actorAgentId).filter((id): id is string => !!id))],
  )
  let mvp: CommentaryMvp | undefined
  let droppedMvp = false
  const rawMvp = asRecord(record.mvp)
  if (rawMvp) {
    const agentId = stringOr(rawMvp.agentId)
    const reason = clampText(rawMvp.reason, MVP_REASON_MAX)
    if (agentId && reason && roster.has(agentId)) {
      mvp = { agentId, reason }
    } else {
      droppedMvp = true
    }
  }

  return {
    ok: true,
    commentary: mvp ? { headline, summary, highlights, mvp } : { headline, summary, highlights },
    droppedHighlights: dropped,
    invalidSeqs,
    droppedMvp,
  }
}

// ---------------------------------------------------------------------------
// 留存事件构造（match/commentary，visibility public）
// ---------------------------------------------------------------------------

export const COMMENTARY_EVENT_KIND = 'match/commentary'

/** match/commentary 事件 payload：校验后的解说 + 溯源（永不包含密钥）。 */
export type CommentaryEventPayload = {
  commentary: CommentaryPayload
  source: CommentarySource
}

export function buildCommentaryEvent(input: {
  matchId: string
  gameType: GameType
  seq: number
  commentary: CommentaryPayload
  source: CommentarySource
}): GameEvent {
  const payload: CommentaryEventPayload = { commentary: input.commentary, source: input.source }
  return {
    id: newEventId(),
    matchId: input.matchId,
    gameType: input.gameType,
    seq: input.seq,
    occurredAt: input.source.createdAt,
    kind: COMMENTARY_EVENT_KIND,
    actorAgentId: null,
    payload: payload as unknown as Record<string, unknown>,
    visibility: 'public',
    restrictedTo: null,
  }
}
