/**
 * 德扑品类呈现契约实现（spec: docs/specs/presentation-contract.md）。
 *
 * 四支柱纯派生：态势（座位/筹码/焦点）/ 事件流 hints（16 种 engine2 kind）/
 * 阶段模型（手数 × 街）/ 结算（finish.ranking）。纯函数、无 IO；复用
 * plugin-v2 与前端 poker-v2 投影的同一套引擎语义，不引入第二真相。
 */

import type {
  PresentationEventHint,
  PresentationModule,
  PresentationPhaseBoundary,
  PresentationPhaseModel,
  PresentationSettlement,
  PresentationSettlementRow,
  PresentationSituationRow,
  PresentationSituationView,
} from '@/platform/engine/presentation'
import { cardCode } from '../engine2'
import type { MatchState, PokerEvent } from '../engine2'

/** DB payload（引擎事件 JSON）→ 德扑事件的识别 guard（与 plugin-v2 同一口径）。 */
function isPokerEventPayload(value: unknown): value is PokerEvent & Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<PokerEvent>
  return (
    typeof candidate.kind === 'string' &&
    typeof candidate.seq === 'number' &&
    typeof candidate.hand === 'number' &&
    typeof candidate.audience === 'object' &&
    candidate.audience !== null &&
    !('payload' in candidate)
  )
}

// ---------------------------------------------------------------------------
// ① 态势视图
// ---------------------------------------------------------------------------

function situationOf(state: MatchState): PresentationSituationView {
  const players: PresentationSituationRow[] = state.players.map((player) => ({
    agentId: player.seatId,
    seat: player.seat,
    status:
      player.status === 'folded'
        ? 'sidelined'
        : player.status === 'eliminated'
          ? 'eliminated'
          : 'active',
    resources: [{ label: '筹码', value: player.stack }],
    privateNote: player.holeCards.length > 0 ? player.holeCards.map(cardCode).join(' ') : null,
  }))
  const pot = state.players.reduce((sum, player) => sum + player.totalCommitted, 0)
  return {
    players,
    focusAgentId: state.currentActor,
    commons: [
      { label: '底池', value: String(pot) },
      { label: '当前注', value: String(state.hand?.currentBet ?? 0) },
      { label: '盲注', value: `${state.blinds.sb}/${state.blinds.bb}` },
      { label: '级别', value: String(state.level) },
    ],
  }
}

// ---------------------------------------------------------------------------
// ② 事件流 display hints（engine2 全部 16 种 kind）
// ---------------------------------------------------------------------------

const POKER_EVENT_HINTS: Record<string, PresentationEventHint> = {
  'match-config': { category: 'system', icon: '⚙', label: '对局配置' },
  'randomness-established': { category: 'reveal', icon: '🎲', label: '随机性建立', godOnly: true },
  'hand-started': { category: 'phase', icon: '▶', label: '手牌开始' },
  'deck-shuffled': { category: 'reveal', icon: '🎲', label: '洗牌', godOnly: true },
  'hole-cards-dealt': { category: 'reveal', icon: '🃏', label: '发底牌', godOnly: true },
  'blinds-posted': { category: 'action', icon: '💵', label: '盲注投入' },
  'street-dealt': { category: 'phase', icon: '🃏', label: '发公共牌' },
  'run-out-started': { category: 'phase', icon: '⚡', label: 'Run-out' },
  'action-made': { category: 'action', icon: '▸', label: '下注动作' },
  'cards-revealed': { category: 'reveal', icon: '🃏', label: '亮牌' },
  'pot-awarded': { category: 'award', icon: '🏆', label: '派彩', severity: 'success' },
  'hand-ended': { category: 'phase', icon: '■', label: '手牌结束' },
  'blind-level-raised': { category: 'system', icon: '↑', label: '盲注升级' },
  'player-eliminated': { category: 'death', icon: '✕', label: '淘汰', severity: 'warning' },
  'match-finished': { category: 'system', icon: '🏁', label: '终局', severity: 'success' },
  'stop-requested': { category: 'system', icon: '⏹', label: '结束请求', severity: 'warning' },
}

function eventHints(): Record<string, PresentationEventHint> {
  return { ...POKER_EVENT_HINTS }
}

// ---------------------------------------------------------------------------
// ③ 阶段模型
// ---------------------------------------------------------------------------

const POKER_PHASES = [
  'preflop',
  'flop',
  'turn',
  'river',
  'showdown',
  'between-hands',
  'finished',
] as const

/** 产生阶段边界的事件 kind → 该边界处的阶段名（cycle 取事件自身 hand）。 */
const BOUNDARY_KINDS: Readonly<Record<string, string>> = {
  'hand-started': 'preflop',
  'street-dealt': 'street', // 占位：实际街名取事件 street 字段
  'run-out-started': 'showdown',
  'hand-ended': 'between-hands',
  'match-finished': 'finished',
}

function phaseModelOf(
  state: MatchState,
  fullStream?: readonly Record<string, unknown>[],
): PresentationPhaseModel {
  const current =
    state.phase === 'finished'
      ? 'finished'
      : state.phase === 'between-hands'
        ? 'between-hands'
        : (state.hand?.street ?? 'preflop')
  const boundaries: PresentationPhaseBoundary[] = []
  if (fullStream) {
    for (const raw of fullStream) {
      if (!isPokerEventPayload(raw)) continue
      const phase = BOUNDARY_KINDS[raw.kind]
      if (phase === undefined) continue
      boundaries.push({
        seq: raw.seq,
        cycle: raw.hand,
        phase: phase === 'street' && (raw.street === 'flop' || raw.street === 'turn' || raw.street === 'river') ? raw.street : phase,
      })
    }
  }
  return { phases: [...POKER_PHASES], current, cycle: state.handNumber, boundaries }
}

// ---------------------------------------------------------------------------
// ④ 结算结构
// ---------------------------------------------------------------------------

const FINISH_REASON_ZH: Record<string, string> = {
  natural: '自然终局',
  'controlled-after-hand': '本手后结束',
  'controlled-immediate': '强制结束（人为终止）',
}

function settlementOf(state: MatchState): PresentationSettlement | null {
  const finish = state.finish
  if (!finish) return null
  const rows: PresentationSettlementRow[] = finish.ranking.map((row) => ({
    agentId: row.seatId,
    rank: row.rank,
    score: row.chips,
    role: null,
  }))
  const digest = [
    { label: '结束原因', value: FINISH_REASON_ZH[finish.reason] ?? finish.reason },
    { label: '总手数', value: String(state.handNumber) },
  ]
  if (finish.terminatedAt) {
    digest.push({ label: '终止时点', value: `seq ${finish.terminatedAt.seq} · 第 ${finish.terminatedAt.hand} 手` })
  }
  return {
    winnerLabel: rows.find((row) => row.rank === 1)?.agentId ?? null,
    rows,
    digest,
  }
}

// ---------------------------------------------------------------------------
// 契约面
// ---------------------------------------------------------------------------

export const pokerPresentation: PresentationModule<MatchState> = {
  situation: situationOf,
  eventHints,
  phaseModel: phaseModelOf,
  settlement: settlementOf,
}
