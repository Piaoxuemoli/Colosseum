/**
 * 狼人杀品类呈现契约实现（spec: docs/specs/presentation-contract.md）。
 *
 * 四支柱纯派生：态势（存活/身份/焦点）/ 事件流 hints（engine2 全部 kind）/
 * 阶段模型（天数 × 昼夜阶段）/ 结算（阵营排名 + 全员身份）。纯函数、无 IO；
 * 排序语义与 plugin-v2 的 toMatchResult 一致，不引入第二真相。
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
import { factionOf } from '../engine2'
import type { WerewolfEngineState, WerewolfEvent } from '../engine2'

/** DB payload（引擎事件 JSON）→ 狼人杀事件的识别 guard（与 plugin-v2 同一口径）。 */
function isWerewolfEventPayload(value: unknown): value is WerewolfEvent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<WerewolfEvent>
  return (
    typeof candidate.kind === 'string' &&
    typeof candidate.seq === 'number' &&
    typeof candidate.day === 'number' &&
    typeof candidate.audience === 'object' &&
    candidate.audience !== null &&
    typeof (candidate as { payload?: unknown }).payload === 'object' &&
    (candidate as { payload?: unknown }).payload !== null
  )
}

// ---------------------------------------------------------------------------
// ① 态势视图
// ---------------------------------------------------------------------------

function situationOf(state: WerewolfEngineState): PresentationSituationView {
  const players: PresentationSituationRow[] = state.players.map((player) => ({
    agentId: player.playerId,
    seat: player.seat,
    status: player.alive ? 'active' : 'eliminated',
    resources: [],
    // 身份是上帝视角注记（公开视角渲染应省略；终局揭示后即公共事实）。
    privateNote: player.alive ? player.role : `${player.role}（出局）`,
  }))
  const alive = state.players.filter((player) => player.alive).length
  const isNight = state.phase === 'ended' ? false : state.phase.startsWith('night')
  return {
    players,
    focusAgentId: state.pendingActor,
    commons: [
      { label: '天数', value: String(state.day) },
      { label: '存活', value: `${alive}/${state.players.length}` },
      { label: '昼夜', value: state.phase === 'ended' ? '已终局' : isNight ? '夜' : '昼' },
    ],
  }
}

// ---------------------------------------------------------------------------
// ② 事件流 display hints（engine2 全部 kind）
// ---------------------------------------------------------------------------

const WEREWOLF_EVENT_HINTS: Record<string, PresentationEventHint> = {
  matchStarted: { category: 'system', icon: '⚙', label: '开局配置' },
  randomnessSeed: { category: 'system', icon: '🎲', label: '随机种子', godOnly: true },
  rolesAssigned: { category: 'reveal', icon: '🎭', label: '身份分发', godOnly: true },
  teammatesRevealed: { category: 'reveal', icon: '🐺', label: '狼队互识', godOnly: true },
  phaseEntered: { category: 'phase', icon: '▶', label: '阶段切换' },
  guardTargetChosen: { category: 'action', icon: '🛡', label: '守护', godOnly: true },
  wolfKillVote: { category: 'action', icon: '🗡', label: '刀口投票', godOnly: true },
  wolfKillAgreed: { category: 'action', icon: '🗡', label: '刀口商定', godOnly: true },
  knifeTargetRevealed: { category: 'action', icon: '🗡', label: '刀口告知', godOnly: true },
  witchSaveDecision: { category: 'action', icon: '💊', label: '解药决策', godOnly: true },
  witchPoisonDecision: { category: 'action', icon: '☠', label: '毒药决策', godOnly: true },
  seerChecked: { category: 'action', icon: '🔮', label: '查验', godOnly: true },
  seerSkipped: { category: 'action', icon: '🔮', label: '查验跳过', godOnly: true },
  nightSettled: { category: 'phase', icon: '🌙', label: '夜间结算', godOnly: true },
  deathsAnnounced: { category: 'death', icon: '✕', label: '死讯公告', severity: 'warning' },
  hunterShootPermission: { category: 'action', icon: '🔫', label: '开枪许可', godOnly: true },
  hunterShot: { category: 'action', icon: '🔫', label: '猎人开枪', severity: 'critical' },
  hunterDeclined: { category: 'action', icon: '🔫', label: '猎人憋枪', godOnly: true },
  lastWords: { category: 'speech', icon: '💬', label: '遗言' },
  speech: { category: 'speech', icon: '💬', label: '发言' },
  voteCast: { category: 'vote', icon: '🗳', label: '投票' },
  voteResult: { category: 'vote', icon: '📊', label: '计票结果' },
  sheriffCampaign: { category: 'system', icon: '🎖', label: '警长竞选' },
  sheriffBadgeTransfer: { category: 'system', icon: '🎖', label: '警徽移交' },
  idiotFlipped: { category: 'reveal', icon: '🎭', label: '白痴翻牌' },
  selfExplode: { category: 'action', icon: '💥', label: '自爆', severity: 'critical' },
  gameEnded: { category: 'system', icon: '🏁', label: '终局', severity: 'success' },
}

function eventHints(): Record<string, PresentationEventHint> {
  return { ...WEREWOLF_EVENT_HINTS }
}

// ---------------------------------------------------------------------------
// ③ 阶段模型（PhaseId 全集）
// ---------------------------------------------------------------------------

const WEREWOLF_PHASES = [
  'night.guard',
  'night.wolves',
  'night.witch.save',
  'night.witch.poison',
  'night.seer',
  'day.announce',
  'day.hunterWindow',
  'day.lastWords',
  'day.speech',
  'day.vote',
  'day.pkSpeech',
  'day.pkVote',
  'ended',
] as const

function phaseModelOf(
  state: WerewolfEngineState,
  fullStream?: readonly Record<string, unknown>[],
): PresentationPhaseModel {
  const boundaries: PresentationPhaseBoundary[] = []
  if (fullStream) {
    for (const raw of fullStream) {
      if (!isWerewolfEventPayload(raw) || raw.kind !== 'phaseEntered') continue
      const phase = raw.payload.phase
      if (typeof phase === 'string') boundaries.push({ seq: raw.seq, cycle: raw.day, phase })
    }
  }
  return { phases: [...WEREWOLF_PHASES], current: state.phase, cycle: state.day, boundaries }
}

// ---------------------------------------------------------------------------
// ④ 结算结构（排序与 plugin-v2 toMatchResult 同口径：胜方 → 存活 → 座位）
// ---------------------------------------------------------------------------

const WINNER_ZH: Record<string, string> = {
  wolves: '狼人阵营',
  good: '好人阵营',
  tie: '平局',
}

function settlementOf(state: WerewolfEngineState): PresentationSettlement | null {
  const outcome = state.outcome
  if (!outcome) return null
  const factionRank = (player: WerewolfEngineState['players'][number]): number => {
    if (outcome.winner === 'tie') return 0
    return factionOf(player.role) === outcome.winner ? 0 : 1
  }
  const rows: PresentationSettlementRow[] = [...state.players]
    .sort((a, b) => {
      const diff = factionRank(a) - factionRank(b)
      if (diff !== 0) return diff
      const aliveDiff = (a.alive ? 0 : 1) - (b.alive ? 0 : 1)
      if (aliveDiff !== 0) return aliveDiff
      return a.seat - b.seat
    })
    .map((player, index) => ({
      agentId: player.playerId,
      rank: index + 1,
      score: factionRank(player) === 0 ? 1 : 0,
      role: player.role,
    }))
  return {
    winnerLabel: WINNER_ZH[outcome.winner] ?? outcome.winner,
    rows,
    digest: [
      { label: '胜负依据', value: outcome.basis },
      { label: '总天数', value: String(state.day) },
    ],
  }
}

// ---------------------------------------------------------------------------
// 契约面
// ---------------------------------------------------------------------------

export const werewolfPresentation: PresentationModule<WerewolfEngineState> = {
  situation: situationOf,
  eventHints,
  phaseModel: phaseModelOf,
  settlement: settlementOf,
}
