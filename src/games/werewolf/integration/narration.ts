/**
 * 狼人杀主持人旁白触发判定（FR-4.7-01 / R3-3）——纯函数，无 IO。
 *
 * 职责：
 * 1. 判定一个事件批是否落在「关键公开边界」上（值得让 LLM 主持人写解说
 *    旁白）：死讯公告（含平安夜）/ 放逐计票 / 终局揭示；
 * 2. 为该批渲染 **仅含公开事件** 的 digest 行——这是「仅公开信息约束」的
 *    结构性强制点：非 public 受众（狼队 / 角色 / 主持人私密事件）在进入
 *    digest 之前就被过滤，任何受限 payload 永远到不了 LLM prompt。
 *
 * 消费方：backend/match/narration.ts（GM tick 的旁白钩子）。插件面不改
 * platform 契约（GameModuleV2 无旁白成员），backend 按 gameType 直接分发
 * 到本模块（与 v2-agent-branch 的装配模式一致）。
 */

import type { V2Event } from '@/platform/engine/contracts-v2'
import type { WerewolfEngineState } from '../engine2'

/** 触发旁白的 engine2 kind（全部 public 受众事件）。 */
export const WEREWOLF_NARRATION_TRIGGER_KINDS = ['deathsAnnounced', 'voteResult', 'gameEnded'] as const

/** digest 规模上限：上下文窗口 / 总行数 / 发言摘录长度（防 prompt 膨胀）。 */
export const NARRATION_CONTEXT_EVENTS = 12
export const NARRATION_MAX_DIGEST_LINES = 20
export const NARRATION_EXCERPT_CHARS = 40

export type WerewolfNarrationTrigger = {
  /** 本批触发了旁白的 engine2 kind（去重，按流内顺序）。 */
  focusKinds: string[]
  /** 仅由 public 事件渲染出的中文事实行（含触发事件 + 此前公开上下文）。 */
  publicDigest: string[]
}

// ---------------------------------------------------------------------------
// 小工具（防御性读取：输入来自落库 JSON，不信任形状）
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringOr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOr(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function excerpt(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

/** agentId → 「N 号位」（座位是 matchStarted 即公开的事实；未知 id 原样返回）。 */
function seatOf(state: WerewolfEngineState, agentId: string | null): string {
  if (!agentId) return '?'
  const seat = state.players.find((player) => player.playerId === agentId)?.seat
  return typeof seat === 'number' ? `${seat} 号位` : agentId
}

function isPublicAudience(audience: unknown): boolean {
  return asRecord(audience)?.kind === 'public'
}

// ---------------------------------------------------------------------------
// 公开事件 → 中文事实行（渲染器只认识 public kind；未知 kind 返回 null）
// ---------------------------------------------------------------------------

const CAUSE_ZH: Record<string, string> = {
  'wolf-kill': '夜刀',
  poison: '毒杀',
  shot: '枪杀',
  exile: '票出',
  'milk-pierce': '奶穿',
  'self-explode': '自爆',
  lovers: '殉情',
}

const ROLE_ZH: Record<string, string> = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  villager: '平民',
  guard: '守卫',
  idiot: '白痴',
}

const VOTE_OUTCOME_ZH: Record<string, string> = {
  exile: '放逐',
  'tie-pk': '平票进入 PK',
  'no-exile': '无人出局',
  'no-exile-after-pk': 'PK 后平票，无人出局',
  'no-majority': '未过半，无人出局',
}

const WINNER_ZH: Record<string, string> = {
  wolves: '狼人阵营',
  good: '好人阵营',
  tie: '双方',
}

/** 单个公开事件 → 事实行；无法渲染（未知 kind / 载荷缺失）返回 null。 */
function renderPublicLine(
  state: WerewolfEngineState,
  ev: { kind: unknown; day: unknown; actorId?: unknown; payload: unknown },
): string | null {
  const kind = stringOr(ev.kind)
  if (!kind) return null
  const day = numberOr(ev.day) ?? 0
  const payload = asRecord(ev.payload) ?? {}

  switch (kind) {
    case 'matchStarted': {
      const seats = Array.isArray(payload.seats) ? payload.seats.length : 0
      return `第 0 天开局：${seats} 名玩家入座`
    }
    case 'phaseEntered': {
      const phase = stringOr(payload.phase)
      return phase ? `第 ${day} 天进入阶段 ${phase}` : null
    }
    case 'deathsAnnounced': {
      const announceKind = stringOr(payload.kind)
      const seats = Array.isArray(payload.seatNumbers)
        ? payload.seatNumbers.flatMap((seat) => {
            const n = numberOr(seat)
            return n === null ? [] : [n]
          })
        : []
      if (announceKind === 'peaceful' || seats.length === 0) {
        return `第 ${day} 天天亮公告：平安夜，昨夜无人死亡`
      }
      const causes = Array.isArray(payload.causes)
        ? payload.causes.map((group) =>
            Array.isArray(group)
              ? group.map((c) => CAUSE_ZH[String(c)] ?? String(c)).join('＋')
              : '',
          )
        : null
      const roles = Array.isArray(payload.roles)
        ? payload.roles.map((r) => ROLE_ZH[String(r)] ?? String(r))
        : null
      const detail = seats
        .map((seat, index) => {
          const parts: string[] = []
          if (causes?.[index]) parts.push(`死因:${causes[index]}`)
          if (roles?.[index]) parts.push(`身份:${roles[index]}`)
          return parts.length > 0 ? `${seat} 号位（${parts.join('，')}）` : `${seat} 号位`
        })
        .join('、')
      return `第 ${day} 天天亮公告：昨夜 ${detail} 出局`
    }
    case 'hunterShot': {
      const hunter = seatOf(state, stringOr(payload.hunterId))
      const target = seatOf(state, stringOr(payload.targetId))
      return `第 ${day} 天${hunter}（猎人翻牌）开枪带走 ${target}`
    }
    case 'lastWords': {
      const player = seatOf(state, stringOr(payload.playerId) ?? stringOr(ev.actorId))
      const content = stringOr(payload.content)
      return content
        ? `第 ${day} 天${player}遗言：「${excerpt(content, NARRATION_EXCERPT_CHARS)}」`
        : `第 ${day} 天${player}未留下遗言`
    }
    case 'speech': {
      const player = seatOf(state, stringOr(payload.playerId))
      const content = stringOr(payload.content) ?? ''
      if (!player) return null
      return `第 ${day} 天${player}发言：「${excerpt(content, NARRATION_EXCERPT_CHARS)}」`
    }
    case 'voteCast': {
      const voter = seatOf(state, stringOr(payload.voterId))
      if (!voter) return null
      const target = stringOr(payload.targetId)
      return `第 ${day} 天${voter}${target ? `投票给 ${seatOf(state, target)}` : '弃票'}`
    }
    case 'voteResult': {
      const outcome = stringOr(payload.outcome) ?? ''
      const exiled = stringOr(payload.exiledId)
      const tally = Array.isArray(payload.tally)
        ? payload.tally.flatMap((entry) => {
            const row = asRecord(entry)
            if (!row) return []
            const votes = numberOr(row.votes)
            const target = stringOr(row.targetId)
            return [{ target, votes: votes ?? 0 }]
          })
        : []
      const tallyText =
        tally.length > 0
          ? `（票型：${tally
              .slice(0, 4)
              .map((row) => (row.target ? `${seatOf(state, row.target)} ${row.votes} 票` : `弃票 ${row.votes}`))
              .join('、')}）`
          : ''
      const outcomeText = VOTE_OUTCOME_ZH[outcome] ?? outcome
      const exiledText = exiled ? `，${seatOf(state, exiled)}被放逐出局` : ''
      return `第 ${day} 天计票：${outcomeText}${exiledText}${tallyText}`
    }
    case 'gameEnded': {
      const winner = stringOr(payload.winner) ?? 'tie'
      const basis = stringOr(payload.basis)
      const reveal = Array.isArray(payload.reveal)
        ? payload.reveal.flatMap((entry) => {
            const row = asRecord(entry)
            if (!row) return []
            const playerId = stringOr(row.playerId)
            const role = stringOr(row.role)
            return playerId && role ? [`${seatOf(state, playerId)}=${ROLE_ZH[role] ?? role}`] : []
          })
        : []
      const revealText =
        reveal.length > 0 ? `；身份揭示：${excerpt(reveal.join('、'), NARRATION_EXCERPT_CHARS * 2)}` : ''
      return `第 ${day} 天终局：${WINNER_ZH[winner] ?? winner}获胜（${basis ?? '依据未知'}）${revealText}`
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// 触发判定（单一入口；纯函数）
// ---------------------------------------------------------------------------

/** 批内单个 V2 事件是否为旁白触发点（仅 public 受众的宣告类事件）。 */
function isTriggerEvent(ev: V2Event): boolean {
  if (ev.audience.kind !== 'public') return false
  if (ev.kind === 'deathsAnnounced' || ev.kind === 'gameEnded') return true
  if (ev.kind === 'voteResult') {
    // 只有实际放逐的计票才是「关键事件」；平票 / 无人出局留给流程宣告。
    const outcome = asRecord(ev.raw.payload)?.outcome
    return outcome === 'exile'
  }
  return false
}

/**
 * 判定一个引擎事件批是否触发主持人旁白，并渲染「仅公开信息」digest。
 *
 * @param state    批应用后的引擎状态（只用 players 座位映射这一公开事实）
 * @param batch    本批的引擎事件（V2 信封；audience 是唯一可见性真相）
 * @param context  此前已落库的事件本体（引擎事件 JSON；只取 public 子集做上下文）
 * @returns 触发信息；非关键边界返回 null
 */
export function werewolfNarrationTrigger(
  state: WerewolfEngineState,
  batch: readonly V2Event[],
  context: readonly Record<string, unknown>[] = [],
): WerewolfNarrationTrigger | null {
  const focusKinds: string[] = []
  for (const ev of batch) {
    if (isTriggerEvent(ev) && !focusKinds.includes(ev.kind)) focusKinds.push(ev.kind)
  }
  if (focusKinds.length === 0) return null

  // 仅公开信息约束：digest 只接受 audience.kind === 'public' 的事件本体，
  // 受限事件（狼队 / 角色 / 主持人私密）在渲染前即被丢弃。
  const publicContext = context.filter((ev) => isPublicAudience(asRecord(ev.audience))).slice(-NARRATION_CONTEXT_EVENTS)

  const lines: string[] = []
  const pushLine = (rendered: string | null): void => {
    if (rendered !== null && lines.length < NARRATION_MAX_DIGEST_LINES) lines.push(rendered)
  }
  for (const ev of publicContext) {
    if (lines.length >= NARRATION_MAX_DIGEST_LINES) break
    pushLine(renderPublicLine(state, { kind: ev.kind, day: ev.day, actorId: ev.actorId, payload: ev.payload }))
  }
  for (const ev of batch) {
    if (ev.audience.kind !== 'public') continue
    if (lines.length >= NARRATION_MAX_DIGEST_LINES) break
    pushLine(renderPublicLine(state, { kind: ev.kind, day: ev.raw.day, actorId: ev.raw.actorId, payload: ev.raw.payload }))
  }

  return { focusKinds, publicDigest: lines }
}
