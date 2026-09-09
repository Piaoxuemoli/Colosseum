/**
 * 阿瓦隆品类呈现契约实现（spec: docs/specs/presentation-contract.md）。
 *
 * 四支柱纯派生：态势（座位/身份注记/焦点行动者）/ 事件流 hints（engine2
 * 全部 15 个 kind）/ 阶段模型（任务轮 × 讨论-提名-表决-任务-合议-刺杀）/
 * 结算（阵营排名 + 全员身份 + 胜负依据）。纯函数、无 IO；排序语义与
 * plugin-v2 的 toMatchResult 一致，不引入第二真相。
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
import { QUEST_COUNT, failCount, factionOf, successCount } from '../engine2'
import type { AvalonEngineState, AvalonEvent, PhaseId } from '../engine2'

/** DB payload（引擎事件 JSON）→ 阿瓦隆事件的识别 guard（与 plugin-v2 同口径）。 */
function isAvalonEventPayload(value: unknown): value is AvalonEvent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AvalonEvent>
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

const ROLE_ZH: Record<string, string> = {
  merlin: '梅林',
  percival: '派西维尔',
  loyalServant: '忠诚仆从',
  assassin: '刺客',
  morgana: '莫甘娜',
  mordred: '莫德雷德',
  oberon: '奥伯伦',
  minion: '莫德雷德爪牙',
}

const FACTION_ZH: Record<string, string> = { good: '好人', evil: '坏人' }

const PHASE_ZH: Record<PhaseId, string> = {
  discussion: '圆桌讨论',
  proposal: '队伍提名',
  teamVote: '全员表决',
  quest: '任务执行',
  evilConsultation: '刺杀合议',
  assassination: '刺杀指认',
  ended: '已终局',
}

// ---------------------------------------------------------------------------
// ① 态势视图
// ---------------------------------------------------------------------------

function situationOf(state: AvalonEngineState): PresentationSituationView {
  const players: PresentationSituationRow[] = state.players.map((player) => ({
    agentId: player.playerId,
    seat: player.seat,
    // 阿瓦隆无人出局：全员 active。
    status: 'active',
    resources: [],
    // 身份是上帝视角注记（公开视角渲染应省略；终局揭示后即公共事实）。
    privateNote: `${ROLE_ZH[player.role] ?? player.role}（${FACTION_ZH[factionOf(player.role)] ?? factionOf(player.role)}）`,
  }))
  return {
    players,
    focusAgentId: state.pendingActor,
    commons: [
      { label: '任务轮', value: `${Math.max(state.round, 0)}/${QUEST_COUNT}` },
      { label: '任务战绩', value: `${successCount(state)}成功 / ${failCount(state)}失败` },
      { label: '阶段', value: PHASE_ZH[state.phase] },
      { label: '提案序', value: `${state.attempt}/5` },
    ],
  }
}

// ---------------------------------------------------------------------------
// ② 事件流 display hints（engine2 全部 15 个 kind）
// ---------------------------------------------------------------------------

const AVALON_EVENT_HINTS: Record<string, PresentationEventHint> = {
  matchStarted: { category: 'system', icon: '⚙', label: '开局配置' },
  randomnessSeed: { category: 'system', icon: '🎲', label: '随机种子', godOnly: true },
  rolesAssigned: { category: 'reveal', icon: '🎭', label: '身份分发', godOnly: true },
  knowledgeRevealed: { category: 'reveal', icon: '🔮', label: '夜间情报', godOnly: true },
  phaseEntered: { category: 'phase', icon: '▶', label: '阶段切换' },
  leaderAssigned: { category: 'system', icon: '🎖', label: '队长指定' },
  statementIssued: { category: 'speech', icon: '💬', label: '公开发言' },
  evilConsulted: { category: 'speech', icon: '🕯', label: '刺杀合议', godOnly: true },
  teamProposed: { category: 'action', icon: '🤝', label: '队伍提案' },
  voteCast: { category: 'vote', icon: '🗳', label: '记名表决' },
  voteResult: { category: 'vote', icon: '📊', label: '表决结果' },
  questChoice: { category: 'action', icon: '⚔', label: '任务抉择', godOnly: true },
  questResult: { category: 'award', icon: '🏆', label: '任务结果' },
  assassinationDeclared: { category: 'action', icon: '🗡', label: '刺杀指认', severity: 'critical' },
  gameEnded: { category: 'system', icon: '🏁', label: '终局揭示', severity: 'success', godOnly: true },
}

function eventHints(): Record<string, PresentationEventHint> {
  return { ...AVALON_EVENT_HINTS }
}

// ---------------------------------------------------------------------------
// ③ 阶段模型（PhaseId 全集；cycle = 任务轮）
// ---------------------------------------------------------------------------

const AVALON_PHASES: PhaseId[] = [
  'discussion',
  'proposal',
  'teamVote',
  'quest',
  'evilConsultation',
  'assassination',
  'ended',
]

function phaseModelOf(
  state: AvalonEngineState,
  fullStream?: readonly Record<string, unknown>[],
): PresentationPhaseModel {
  const boundaries: PresentationPhaseBoundary[] = []
  if (fullStream) {
    for (const raw of fullStream) {
      if (!isAvalonEventPayload(raw) || raw.kind !== 'phaseEntered') continue
      const phase = raw.payload.phase
      if (typeof phase === 'string') boundaries.push({ seq: raw.seq, cycle: raw.day, phase })
    }
  }
  return { phases: [...AVALON_PHASES], current: state.phase, cycle: state.round, boundaries }
}

// ---------------------------------------------------------------------------
// ④ 结算结构（排序与 plugin-v2 toMatchResult 同口径：胜方 → 座位）
// ---------------------------------------------------------------------------

const WINNER_ZH: Record<string, string> = {
  good: '好人阵营',
  evil: '坏人阵营',
  tie: '平局',
}

function settlementOf(state: AvalonEngineState): PresentationSettlement | null {
  const outcome = state.outcome
  if (!outcome) return null
  const factionRank = (player: AvalonEngineState['players'][number]): number => {
    if (outcome.winner === 'tie') return 0
    return factionOf(player.role) === outcome.winner ? 0 : 1
  }
  const rows: PresentationSettlementRow[] = [...state.players]
    .sort((a, b) => {
      const diff = factionRank(a) - factionRank(b)
      if (diff !== 0) return diff
      return a.seat - b.seat
    })
    .map((player, index) => ({
      agentId: player.playerId,
      rank: index + 1,
      score: factionRank(player) === 0 ? 1 : 0,
      role: ROLE_ZH[player.role] ?? player.role,
    }))
  const digest: Array<{ label: string; value: string }> = [
    { label: '胜负依据', value: outcome.basis },
    { label: '任务战绩', value: `${successCount(state)}成功 / ${failCount(state)}失败` },
    { label: '总轮数', value: String(state.round) },
  ]
  if (state.assassination) {
    const { assassinId, targetId, hitMerlin } = state.assassination
    digest.push({
      label: '刺杀裁决',
      value: `${assassinId} 指认 ${targetId}${hitMerlin ? '（命中梅林，坏人翻盘）' : '（未命中梅林）'}`,
    })
  }
  return {
    winnerLabel: WINNER_ZH[outcome.winner] ?? outcome.winner,
    rows,
    digest,
  }
}

// ---------------------------------------------------------------------------
// 契约面
// ---------------------------------------------------------------------------

export const avalonPresentation: PresentationModule<AvalonEngineState> = {
  situation: situationOf,
  eventHints,
  phaseModel: phaseModelOf,
  settlement: settlementOf,
}
