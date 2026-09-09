/**
 * 阿瓦隆主持人旁白触发判定（AVR-OD-6 可选接入；FR-4.7-01）——纯函数，无 IO。
 *
 * 职责（与 games/werewolf/integration/narration.ts 同族）：
 * 1. 判定一个事件批是否落在「关键公开边界」上（值得让 LLM 主持人写解说
 *    旁白）：任务结算（questResult）、刺杀揭晓（assassinationDeclared）、
 *    终局（gameEnded；连坐触发经终局事件承载——第 5 次拒绝的 voteResult
 *    与紧随的终局同批）；
 * 2. 为该批渲染 **仅含公开事件** 的 digest 行——非 public 受众（发牌 / 情报 /
 *    个人任务抉择 / 坏人合议）在进入 digest 之前就被过滤，任何受限 payload
 *    永远到不了 LLM prompt。delayed-public（终局揭示）仅在终局批解锁渲染。
 *
 * 消费方：backend/match/narration.ts（GM tick 的旁白钩子，按 gameType 条目
 * 注册）。插件面不改 platform 契约（GameModuleV2 无旁白成员）。
 */

import type { V2Event } from '@/platform/engine/contracts-v2'
import type { AvalonEngineState } from '../engine2'

/** 触发旁白的 engine2 kind（questResult / assassinationDeclared 为 public；gameEnded 为终局批解锁）。 */
export const AVALON_NARRATION_TRIGGER_KINDS = ['questResult', 'assassinationDeclared', 'gameEnded'] as const

/** digest 规模上限：上下文窗口 / 总行数 / 发言摘录长度（防 prompt 膨胀）。 */
export const NARRATION_CONTEXT_EVENTS = 12
export const NARRATION_MAX_DIGEST_LINES = 20
export const NARRATION_EXCERPT_CHARS = 40

export type AvalonNarrationTrigger = {
  /** 本批触发了旁白的 engine2 kind（去重，按流内顺序）。 */
  focusKinds: string[]
  /** 仅由公开事件渲染出的中文事实行（含触发事件 + 此前公开上下文）。 */
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
function seatOf(state: AvalonEngineState, agentId: string | null): string {
  if (!agentId) return '?'
  const seat = state.players.find((player) => player.playerId === agentId)?.seat
  return typeof seat === 'number' ? `${seat} 号位` : agentId
}

function isPublicAudience(audience: unknown): boolean {
  return asRecord(audience)?.kind === 'public'
}

function isDelayedPublicAudience(audience: unknown): boolean {
  return asRecord(audience)?.kind === 'delayed-public'
}

// ---------------------------------------------------------------------------
// 公开事件 → 中文事实行（渲染器只认识公开 kind；未知 kind 返回 null）
// ---------------------------------------------------------------------------

const WINNER_ZH: Record<string, string> = { good: '好人阵营', evil: '坏人阵营', tie: '双方' }

/** 单个公开事件 → 事实行；无法渲染（未知 kind / 载荷缺失）返回 null。 */
function renderPublicLine(
  state: AvalonEngineState,
  ev: { kind: unknown; day: unknown; actorId?: unknown; payload: unknown },
): string | null {
  const kind = stringOr(ev.kind)
  if (!kind) return null
  const round = numberOr(ev.day) ?? 0
  const payload = asRecord(ev.payload) ?? {}

  switch (kind) {
    case 'matchStarted': {
      const seats = Array.isArray(payload.seats) ? payload.seats.length : 0
      const name = stringOr(payload.boardName) ?? '阿瓦隆'
      return `第 0 轮开局：${name}，${seats} 名玩家入座`
    }
    case 'phaseEntered': {
      const phase = stringOr(payload.phase)
      return phase ? `第 ${round} 轮进入阶段 ${phase}` : null
    }
    case 'leaderAssigned': {
      const leader = seatOf(state, stringOr(payload.leaderId))
      const attempt = numberOr(payload.attempt) ?? 1
      return `第 ${round} 轮第 ${attempt} 次提案由 ${leader} 担任队长`
    }
    case 'statementIssued': {
      const speaker = seatOf(state, stringOr(payload.speakerId) ?? stringOr(ev.actorId))
      const text = stringOr(payload.text)
      if (!speaker) return null
      return text
        ? `第 ${round} 轮${speaker}发言：「${excerpt(text, NARRATION_EXCERPT_CHARS)}」`
        : `第 ${round} 轮${speaker}未发言（超时跳过）`
    }
    case 'teamProposed': {
      const leader = seatOf(state, stringOr(payload.leaderId))
      const team = Array.isArray(payload.teamIds)
        ? payload.teamIds.flatMap((id) => {
            const s = stringOr(id)
            return s ? [seatOf(state, s)] : []
          })
        : []
      return `第 ${round} 轮${leader}提名队伍：${team.join('、')}`
    }
    case 'voteCast': {
      const voter = seatOf(state, stringOr(payload.voterId))
      if (!voter) return null
      const approve = payload.approve === true
      return `第 ${round} 轮${voter}${approve ? '赞成' : '反对'}该提案`
    }
    case 'voteResult': {
      const approvals = numberOr(payload.approvals) ?? 0
      const rejections = numberOr(payload.rejections) ?? 0
      const attempt = numberOr(payload.attempt) ?? 1
      const outcome = payload.outcome === 'approved' ? '通过' : '被否决'
      return `第 ${round} 轮第 ${attempt} 次表决 ${approvals} 赞成 / ${rejections} 反对，提案${outcome}`
    }
    case 'questResult': {
      const outcome = payload.outcome === 'success' ? '成功' : '失败'
      const failVotes = numberOr(payload.failVotes) ?? 0
      const requiredFails = numberOr(payload.requiredFails) ?? 1
      return `第 ${round} 轮任务${outcome}（失败牌 ${failVotes} 张 / 判失败需 ${requiredFails} 张）`
    }
    case 'assassinationDeclared': {
      const assassin = seatOf(state, stringOr(payload.assassinId))
      const target = seatOf(state, stringOr(payload.targetId))
      return `刺杀时刻：${assassin}指认 ${target} 为梅林`
    }
    case 'gameEnded': {
      const winner = stringOr(payload.winner) ?? 'tie'
      const basis = stringOr(payload.basis)
      return `终局：${WINNER_ZH[winner] ?? winner}获胜（${basis ?? '依据未知'}）`
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// 触发判定（单一入口；纯函数）
// ---------------------------------------------------------------------------

/** 批内单个 V2 事件是否为旁白触发点（任务结算 / 刺杀揭晓 / 终局）。 */
function isTriggerEvent(ev: V2Event): boolean {
  if (ev.kind === 'questResult' || ev.kind === 'assassinationDeclared') {
    return ev.audience.kind === 'public'
  }
  // gameEnded 是 delayed-public：终局批本身即解锁时刻。
  if (ev.kind === 'gameEnded') {
    return ev.audience.kind === 'delayed-public' || ev.audience.kind === 'public'
  }
  return false
}

/**
 * 判定一个引擎事件批是否触发主持人旁白，并渲染「仅公开信息」digest。
 *
 * @param state    批应用后的引擎状态（只用 players 座位映射这一公开事实）
 * @param batch    本批的引擎事件（V2 信封；audience 是唯一可见性真相）
 * @param context  此前已落库的事件本体（引擎事件 JSON；只取公开子集做上下文）
 * @returns 触发信息；非关键边界返回 null
 */
export function avalonNarrationTrigger(
  state: AvalonEngineState,
  batch: readonly V2Event[],
  context: readonly Record<string, unknown>[] = [],
): AvalonNarrationTrigger | null {
  const focusKinds: string[] = []
  let ended = false
  for (const ev of batch) {
    if (isTriggerEvent(ev)) {
      if (!focusKinds.includes(ev.kind)) focusKinds.push(ev.kind)
      if (ev.kind === 'gameEnded') ended = true
    }
  }
  if (focusKinds.length === 0) return null

  // 仅公开信息约束：digest 只接受 public 事件本体；delayed-public（终局揭示）
  // 仅在终局批（gameEnded 已在流中）解锁渲染——种子等延迟事件永不进 digest。
  const digestVisible = (ev: Record<string, unknown>): boolean =>
    isPublicAudience(ev.audience) || (ended && isDelayedPublicAudience(ev.audience))
  const publicContext = context.filter(digestVisible).slice(-NARRATION_CONTEXT_EVENTS)

  const lines: string[] = []
  const pushLine = (rendered: string | null): void => {
    if (rendered !== null && lines.length < NARRATION_MAX_DIGEST_LINES) lines.push(rendered)
  }
  for (const ev of publicContext) {
    if (lines.length >= NARRATION_MAX_DIGEST_LINES) break
    pushLine(renderPublicLine(state, { kind: ev.kind, day: ev.day, actorId: ev.actorId, payload: ev.payload }))
  }
  for (const ev of batch) {
    if (ev.audience.kind !== 'public' && !(ended && ev.audience.kind === 'delayed-public')) continue
    if (lines.length >= NARRATION_MAX_DIGEST_LINES) break
    const raw = asRecord(ev.raw) ?? {}
    pushLine(renderPublicLine(state, { kind: raw.kind, day: raw.day, actorId: raw.actorId, payload: raw.payload }))
  }

  return { focusKinds, publicDigest: lines }
}
