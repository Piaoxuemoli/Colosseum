// 阿瓦隆 engine2 事件投影（docs/prd/games/avalon-frontend.md + 上游事件契约
// docs/prd/games/avalon-engine.md AVR-5xx）。
//
// 消费 `avalon:v2:${kind}` 信封事件（payload = engine2 AvalonEvent 本体逐字段
// 平铺：{ seq, round, audience, actorId, kind, payload: {...} }，与 werewolf-v2
// 的嵌套信封口径一致）。本模块只做两件事：
//
// 1. reduceAvalonV2Event(acc, event)：把事件流累积进 AvalonV2Accumulator
//    （全量真相——名册/板子参数/轮次推进/任务战绩/发言史/记名投票史/
//    刺杀信息/终局揭示/每玩家情报与抉择）。未知 kind 静默忽略
//    （avalon-frontend PRD §6：前后端版本错位不白屏、按已知事件降级）。
// 2. deriveAvalonView(acc, perspective, focus)：视角选择器（AVR-205 三口径同源）——
//    上帝 / 公开 / 单玩家。可见性剥离不发生在累积层（单机私有部署观战端
//    全量持有事件），而是本纯函数在消费时按视角收敛：
//    - 身份：god 即时可见；public 终局揭示前不可见；player 仅本人（+终局全员）；
//    - 密谋（evilConsulted）：god 与坏人玩家可见，其余视角遮蔽占位；
//    - 任务抉择（AVR-108）：个体立场对一切视角保密（终局前含上帝），仅本人
//      可见自己的抉择；
//    - 知识（knowledgeRevealed）：god 全量、player 本人条目、public 无。
//
// 视角驱动的 store 重投影（setViewMode）对本 accumulator 是恒等变换（累积层
// 无视角分支），切角只影响 deriveAvalonView 的输出——与 werewolf-v2 的
// 「累积真相 + 派生剥离」同构，只是剥离点从 reduce 挪到了选择器。

import type { GameEvent } from '@/platform/core/types'
import type { ViewMode } from './common'
import { asRecord, numberOr, stringArrayOr, stringOr } from './common'

export const AVALON_V2_PREFIX = 'avalon:v2:'

export function isAvalonV2Event(event: Pick<GameEvent, 'kind'>): boolean {
  return event.kind.startsWith(AVALON_V2_PREFIX)
}

// ---------------------------------------------------------------------------
// 冻结契约类型（与引擎 agent 对齐，字段名逐字对齐，不得擅改）
// ---------------------------------------------------------------------------

/** 角色枚举（AVR-103 角色池）。 */
export type AvalonRole =
  | 'merlin'
  | 'percival'
  | 'loyalServant'
  | 'assassin'
  | 'morgana'
  | 'mordred'
  | 'oberon'
  | 'minion'

export type AvalonFaction = 'good' | 'evil'

export type AvalonPhase =
  | 'discussion'
  | 'proposal'
  | 'teamVote'
  | 'quest'
  | 'evilConsultation'
  | 'assassination'
  | 'ended'

const AVALON_PHASES = new Set<AvalonPhase>([
  'discussion',
  'proposal',
  'teamVote',
  'quest',
  'evilConsultation',
  'assassination',
  'ended',
])

const EVIL_ROLES = new Set<AvalonRole>(['assassin', 'morgana', 'mordred', 'oberon', 'minion'])

/** 阵营归属（好人 merlin/percival/loyalServant，其余坏人）。 */
export function avalonFactionOfRole(role: string | null | undefined): AvalonFaction | null {
  if (!role) return null
  if (role === 'merlin' || role === 'percival' || role === 'loyalServant') return 'good'
  if (EVIL_ROLES.has(role as AvalonRole)) return 'evil'
  return null
}

export type AvalonSeat = { seat: number; playerId: string }

/** 5 轮任务槽（任务板数据源）。 */
export type AvalonQuestSlot = {
  round: number
  teamSize: number
  /** 双失败轮 = 2，普通轮 = 1（AVR-402）。 */
  requiredFails: number
  status: 'pending' | 'ongoing' | 'success' | 'fail'
  /** 结算后已知的失败张数（不露出牌人，AVR-108）。 */
  failVotes: number | null
}

export type AvalonStatementEntry = {
  round: number
  speakerId: string
  text: string
  kind: 'discussion' | 'consultation'
  /** 兜底接管标记（AVR-304 默认动作事件带默认标记，FR-4.4-04 可见）。 */
  isDefault: boolean
}

export type AvalonVoteRecord = {
  round: number
  attempt: number
  voterId: string
  approve: boolean
}

export type AvalonVoteTally = {
  round: number
  attempt: number
  approvals: number
  rejections: number
  outcome: 'approved' | 'rejected'
}

export type AvalonProposal = {
  round: number
  attempt: number
  leaderId: string
  teamIds: string[]
}

/** 夜间知识（role-self 情报；混排不标注真伪，AVR-203/502）。 */
export type AvalonKnowledgeEntry = {
  playerId: string
  insight: 'merlin' | 'percival' | 'evil'
  playerIds: string[]
}

export type AvalonQuestChoice = { playerId: string; round: number; succeed: boolean }

export type AvalonRevealEntry = { playerId: string; seat: number; role: AvalonRole }

export type AvalonEndState = {
  winner: 'good' | 'evil' | 'tie'
  basis: string
  reveal: AvalonRevealEntry[]
}

// ---------------------------------------------------------------------------
// 累积器
// ---------------------------------------------------------------------------

export type AvalonV2Accumulator = {
  /** 板子标识 / 展示名（matchStarted）。 */
  boardId: string | null
  boardName: string | null
  /** 座位名册（seat 1-based 升序）。 */
  seats: AvalonSeat[]
  /** 板子角色构成（角色 → 数量，展示用）。 */
  roleCounts: Record<string, number>
  /** 板子参数（AVR-101）。 */
  questCount: number
  teamSizes: number[]
  doubleFailRounds: number[]
  discussionEnabled: boolean
  /** randomnessSeed（delayed-public；god 真相，public 不展示）。 */
  seed: number | null
  /** role-self rolesAssigned 累积的身份（god 真相；gameEnded 后全员）。 */
  roles: Record<string, AvalonRole>
  /** 每玩家夜间知识（god/单玩家视角用）。 */
  knowledge: AvalonKnowledgeEntry[]
  /** 每玩家任务抉择（仅本人视角可显示个体立场，AVR-108）。 */
  questChoices: AvalonQuestChoice[]
  /** 阶段机（AVR-102）。 */
  phase: AvalonPhase | null
  round: number
  attempt: number
  leaderId: string | null
  /** 引擎待行动者（proposal → 队长；其余阶段的细粒度推导见 avalonPendingActors）。 */
  pendingActor: string | null
  /** 5 轮任务战绩。 */
  quests: AvalonQuestSlot[]
  proposals: AvalonProposal[]
  voteRecords: AvalonVoteRecord[]
  voteTallies: AvalonVoteTally[]
  /** 发言史（讨论 + 密谋，按到达序）。 */
  statements: AvalonStatementEntry[]
  /** 刺杀信息（AVR-106）。 */
  assassination: { assassinId: string; targetId: string } | null
  /** 终局（延迟公共揭示）。 */
  ended: AvalonEndState | null
  status: 'waiting' | 'live' | 'settled'
}

export function emptyAvalonV2(): AvalonV2Accumulator {
  return {
    boardId: null,
    boardName: null,
    seats: [],
    roleCounts: {},
    questCount: 5,
    teamSizes: [],
    doubleFailRounds: [],
    discussionEnabled: true,
    seed: null,
    roles: {},
    knowledge: [],
    questChoices: [],
    phase: null,
    round: 0,
    attempt: 0,
    leaderId: null,
    pendingActor: null,
    quests: [],
    proposals: [],
    voteRecords: [],
    voteTallies: [],
    statements: [],
    assassination: null,
    ended: null,
    status: 'waiting',
  }
}

// ---------------------------------------------------------------------------
// 信封解析
// ---------------------------------------------------------------------------

/**
 * 字段读取器：优先引擎载荷（ev.payload.*），回退信封平铺（ev.*）——
 * 与 poker-v2（平铺）/ werewolf-v2（嵌套）两种历史形态都兼容。
 */
function fieldReader(ev: Record<string, unknown>, payload: Record<string, unknown>) {
  return {
    str(key: string): string | null {
      return stringOr(payload[key]) ?? stringOr(ev[key])
    },
    num(key: string, fallback: number): number {
      return numberOr(payload[key], numberOr(ev[key], fallback))
    },
    strings(key: string): string[] {
      return stringArrayOr(payload[key]).length > 0 ? stringArrayOr(payload[key]) : stringArrayOr(ev[key])
    },
    bool(key: string): boolean | null {
      const value = payload[key] ?? ev[key]
      return typeof value === 'boolean' ? value : null
    },
  }
}

/** role-self 受众的玩家 id：audience.playerId → actorId → restrictedTo 标签。 */
function roleSelfPlayerOf(ev: Record<string, unknown>, event: GameEvent): string | null {
  const audience = asRecord(ev.audience)
  const viaAudience = audience ? stringOr(audience.playerId) : null
  if (viaAudience) return viaAudience
  const viaActor = stringOr(ev.actorId) ?? event.actorAgentId
  if (viaActor) return viaActor
  for (const tag of event.restrictedTo ?? []) {
    if (tag.startsWith('role-self:')) return tag.slice('role-self:'.length)
  }
  return null
}

function numberArrayOr(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): number[] => (typeof item === 'number' && Number.isFinite(item) ? [item] : []))
}

function parseSeats(value: unknown): AvalonSeat[] {
  if (!Array.isArray(value)) return []
  const rows = value.flatMap((item): AvalonSeat[] => {
    if (typeof item === 'string') return [{ seat: 0, playerId: item }]
    const raw = asRecord(item)
    const playerId = raw ? (stringOr(raw.playerId) ?? stringOr(raw.agentId)) : null
    if (!raw || !playerId) return []
    const seat = numberOr(raw.seat, 0)
    return [{ seat, playerId }]
  })
  // 字符串名册（seat=0 占位）按序补 1-based 座位号；显式 seat 保留原值。
  const hasExplicitSeat = rows.some((row) => row.seat > 0)
  return rows
    .map((row, index) => ({ ...row, seat: hasExplicitSeat && row.seat > 0 ? row.seat : index + 1 }))
    .sort((a, b) => a.seat - b.seat)
}

function buildQuestSlots(questCount: number, teamSizes: number[], doubleFailRounds: number[]): AvalonQuestSlot[] {
  const slots: AvalonQuestSlot[] = []
  for (let round = 1; round <= questCount; round += 1) {
    slots.push({
      round,
      teamSize: teamSizes[round - 1] ?? 0,
      requiredFails: doubleFailRounds.includes(round) ? 2 : 1,
      status: 'pending',
      failVotes: null,
    })
  }
  return slots
}

function isDefaultMarked(payload: Record<string, unknown>, ev: Record<string, unknown>): boolean {
  return payload.isDefault === true || ev.isDefault === true
}

/**
 * 归约一个 `avalon:v2:*` 信封事件。未知 kind 静默忽略（向前兼容，
 * avalon-frontend PRD §6）。
 */
export function reduceAvalonV2Event(acc: AvalonV2Accumulator, event: GameEvent): AvalonV2Accumulator {
  if (!isAvalonV2Event(event)) return acc
  const kind = event.kind.slice(AVALON_V2_PREFIX.length)
  const ev = asRecord(event.payload) ?? {}
  const payload = asRecord(ev.payload) ?? {}
  const read = fieldReader(ev, payload)

  const next: AvalonV2Accumulator = { ...acc }
  const round = read.num('round', acc.round)

  switch (kind) {
    case 'matchStarted': {
      next.boardId = read.str('boardId')
      next.boardName = read.str('boardName')
      const seats = parseSeats(payload.seats ?? ev.seats)
      if (seats.length > 0) next.seats = seats
      next.questCount = read.num('questCount', 5)
      const teamSizes = numberArrayOr(payload.teamSizes).length > 0 ? numberArrayOr(payload.teamSizes) : numberArrayOr(ev.teamSizes)
      if (teamSizes.length > 0) next.teamSizes = teamSizes
      next.doubleFailRounds = numberArrayOr(payload.doubleFailRounds).length > 0
        ? numberArrayOr(payload.doubleFailRounds)
        : numberArrayOr(ev.doubleFailRounds)
      const discussion = read.bool('discussionEnabled')
      next.discussionEnabled = discussion === null ? true : discussion
      const roleCountsRaw = asRecord(payload.roles) ?? asRecord(ev.roles)
      if (roleCountsRaw) {
        const roleCounts: Record<string, number> = {}
        for (const [role, count] of Object.entries(roleCountsRaw)) {
          const value = numberOr(count, 0)
          if (value > 0) roleCounts[role] = value
        }
        next.roleCounts = roleCounts
      }
      next.quests = buildQuestSlots(next.questCount, teamSizes.length > 0 ? teamSizes : next.teamSizes, next.doubleFailRounds)
      if (next.status === 'waiting') next.status = 'live'
      break
    }
    case 'randomnessSeed': {
      const seed = read.num('seed', 0)
      if (seed !== 0) next.seed = seed
      break
    }
    case 'rolesAssigned': {
      const playerId = roleSelfPlayerOf(ev, event)
      const role = read.str('role')
      if (!playerId || !role) break
      next.roles = { ...acc.roles, [playerId]: role as AvalonRole }
      break
    }
    case 'knowledgeRevealed': {
      const playerId = roleSelfPlayerOf(ev, event)
      const insight = read.str('insight')
      if (!playerId || (insight !== 'merlin' && insight !== 'percival' && insight !== 'evil')) break
      next.knowledge = [...acc.knowledge, { playerId, insight, playerIds: read.strings('playerIds') }]
      break
    }
    case 'phaseEntered': {
      const phase = read.str('phase')
      if (!phase || !AVALON_PHASES.has(phase as AvalonPhase)) break
      next.phase = phase as AvalonPhase
      if (phase === 'ended') {
        next.status = 'settled'
        next.pendingActor = null
      }
      if (phase === 'quest' && round >= 1 && round <= acc.quests.length && acc.quests[round - 1].status === 'pending') {
        const quests = acc.quests.slice()
        quests[round - 1] = { ...quests[round - 1], status: 'ongoing' }
        next.quests = quests
      }
      break
    }
    case 'leaderAssigned': {
      next.round = Math.max(acc.round, round)
      next.attempt = read.num('attempt', acc.attempt)
      const leaderId = read.str('leaderId')
      if (leaderId) next.leaderId = leaderId
      next.pendingActor = leaderId
      break
    }
    case 'statementIssued': {
      const speakerId = read.str('speakerId') ?? stringOr(ev.actorId) ?? event.actorAgentId
      const text = read.str('text') ?? ''
      if (!speakerId) break
      next.statements = [
        ...acc.statements,
        { round: Math.max(round, 1), speakerId, text, kind: 'discussion', isDefault: isDefaultMarked(payload, ev) },
      ]
      break
    }
    case 'evilConsulted': {
      const speakerId = read.str('speakerId') ?? stringOr(ev.actorId) ?? event.actorAgentId
      const text = read.str('text') ?? ''
      if (!speakerId) break
      // 坏人组受众可能按「每人一份 role-self 副本」下发（AVR-502 注），按
      // 轮次 + 发言人 + 文本去重，保证两种实现形态同一累积结果。
      const dedupeKey = `${Math.max(round, 1)}:${speakerId}:${text}`
      if (acc.statements.some((entry) => entry.kind === 'consultation' && `${entry.round}:${entry.speakerId}:${entry.text}` === dedupeKey)) {
        break
      }
      next.statements = [
        ...acc.statements,
        { round: Math.max(round, 1), speakerId, text, kind: 'consultation', isDefault: isDefaultMarked(payload, ev) },
      ]
      break
    }
    case 'teamProposed': {
      const proposalRound = round
      const attempt = read.num('attempt', acc.attempt)
      next.round = Math.max(acc.round, proposalRound)
      next.attempt = attempt
      const leaderId = read.str('leaderId')
      if (leaderId) next.leaderId = leaderId
      next.proposals = [
        ...acc.proposals,
        { round: proposalRound, attempt, leaderId: leaderId ?? acc.leaderId ?? '', teamIds: read.strings('teamIds') },
      ]
      break
    }
    case 'voteCast': {
      const voterId = read.str('voterId') ?? stringOr(ev.actorId) ?? event.actorAgentId
      if (!voterId) break
      const approve = read.bool('approve')
      next.voteRecords = [
        ...acc.voteRecords,
        { round, attempt: read.num('attempt', acc.attempt), voterId, approve: approve === true },
      ]
      break
    }
    case 'voteResult': {
      const outcome = read.str('outcome')
      if (outcome !== 'approved' && outcome !== 'rejected') break
      next.voteTallies = [
        ...acc.voteTallies,
        {
          round,
          attempt: read.num('attempt', acc.attempt),
          approvals: read.num('approvals', 0),
          rejections: read.num('rejections', 0),
          outcome,
        },
      ]
      break
    }
    case 'questChoice': {
      const playerId = roleSelfPlayerOf(ev, event) ?? read.str('playerId')
      if (!playerId) break
      const succeed = read.bool('succeed')
      next.questChoices = [...acc.questChoices, { playerId, round, succeed: succeed === true }]
      break
    }
    case 'questResult': {
      const outcome = read.str('outcome')
      if (round < 1 || round > acc.quests.length || (outcome !== 'success' && outcome !== 'fail')) break
      const quests = acc.quests.slice()
      quests[round - 1] = {
        ...quests[round - 1],
        status: outcome === 'success' ? 'success' : 'fail',
        failVotes: read.num('failVotes', 0),
        requiredFails: read.num('requiredFails', quests[round - 1].requiredFails),
      }
      next.quests = quests
      break
    }
    case 'assassinationDeclared': {
      const assassinId = read.str('assassinId')
      const targetId = read.str('targetId')
      if (!assassinId || !targetId) break
      next.assassination = { assassinId, targetId }
      next.pendingActor = null
      break
    }
    case 'gameEnded': {
      const winnerRaw = read.str('winner')
      const winner = winnerRaw === 'good' || winnerRaw === 'evil' || winnerRaw === 'tie' ? winnerRaw : null
      const revealRaw = Array.isArray(payload.reveal) ? payload.reveal : Array.isArray(ev.reveal) ? ev.reveal : []
      const reveal = revealRaw.flatMap((item): AvalonRevealEntry[] => {
        const raw = asRecord(item)
        const playerId = raw ? stringOr(raw.playerId) : null
        const role = raw ? stringOr(raw.role) : null
        if (!raw || !playerId || !role) return []
        return [{ playerId, seat: numberOr(raw.seat, 0), role: role as AvalonRole }]
      })
      const roles = { ...acc.roles }
      for (const entry of reveal) roles[entry.playerId] = entry.role
      next.roles = roles
      next.ended = { winner: winner ?? 'tie', basis: read.str('basis') ?? '', reveal }
      next.status = 'settled'
      next.phase = 'ended'
      next.pendingActor = null
      break
    }
    default: {
      // 未知 kind：静默忽略（向前兼容，PRD §6 降级）。
      break
    }
  }

  return next
}

// ---------------------------------------------------------------------------
// 派生量（纯函数）
// ---------------------------------------------------------------------------

/** 任务板比分：好人成功数 vs 坏人失败数（3:3 赛点，AVR-101 参数 7）。 */
export function avalonScoreOf(acc: AvalonV2Accumulator): { successes: number; fails: number } {
  let successes = 0
  let fails = 0
  for (const quest of acc.quests) {
    if (quest.status === 'success') successes += 1
    else if (quest.status === 'fail') fails += 1
  }
  return { successes, fails }
}

/** 本轮已被拒绝的提案次数（连坐计数，AVR-403：第 5 次拒绝 → 坏人直接胜）。 */
export function avalonRejectionCountOf(acc: AvalonV2Accumulator): number {
  return acc.voteTallies.filter((tally) => tally.round === acc.round && tally.outcome === 'rejected').length
}

/** 好人拿满 3 成功（→ 刺杀环节，AVR-106）。 */
export function avalonGoodAtMatchPoint(acc: AvalonV2Accumulator): boolean {
  return avalonScoreOf(acc).successes >= 3 && acc.ended === null
}

/** 当前轮成功获批的提案（= 正在执行/最近执行的任务队伍）。 */
export function avalonCurrentTeamOf(acc: AvalonV2Accumulator): string[] {
  const approved = [...acc.voteTallies].reverse().find((tally) => tally.round === acc.round && tally.outcome === 'approved')
  if (!approved) return []
  return acc.proposals.find((proposal) => proposal.round === approved.round && proposal.attempt === approved.attempt)?.teamIds ?? []
}

/** 当前任务队伍的显示文本（座位序名单；尚未提名时占位）。 */
export function avalonTeamText(acc: AvalonV2Accumulator, nameOf: (agentId: string) => string): string {
  const team = avalonCurrentTeamOf(acc)
  if (team.length === 0) return '（尚未提名）'
  return team.map(nameOf).join(' · ')
}

/** god 真相下的坏人名单（按座位序）。 */
export function avalonEvilPlayerIdsOf(acc: AvalonV2Accumulator): string[] {
  return acc.seats
    .map((seat) => seat.playerId)
    .filter((playerId) => avalonFactionOfRole(acc.roles[playerId]) === 'evil')
}

/** 刺杀权持有者（god 真相）：刺客角色卡；无卡时座位序首名坏人（AVR-OD-1b）。 */
export function avalonAssassinOf(acc: AvalonV2Accumulator): string | null {
  for (const seat of acc.seats) {
    if (acc.roles[seat.playerId] === 'assassin') return seat.playerId
  }
  return avalonEvilPlayerIdsOf(acc)[0] ?? null
}

// ---------------------------------------------------------------------------
// 视角选择器（AVR-205）
// ---------------------------------------------------------------------------

export type AvalonPerspective = 'god' | 'public' | 'player'

/** store viewMode + 阿瓦隆聚焦玩家 → 三视角（god 默认 / public / 单玩家）。 */
export function avalonPerspectiveOf(viewMode: ViewMode, focusPlayerId: string | null): AvalonPerspective {
  if (viewMode === 'public') return 'public'
  return focusPlayerId ? 'player' : 'god'
}

export type AvalonVisibleStatement = AvalonStatementEntry & { hidden: boolean }

export type AvalonView = {
  perspective: AvalonPerspective
  focusPlayerId: string | null
  /** 终局揭示（gameEnded 已到）。 */
  revealed: boolean
  winner: 'good' | 'evil' | 'tie' | null
  /** 视角可见的座位角色（god 全量 / player 本人 / public 终局前空）。 */
  visibleRoles: Record<string, AvalonRole>
  /** 发言流（讨论全可见；密谋按视角遮蔽，hidden=true 时文本不可呈现）。 */
  statements: AvalonVisibleStatement[]
  /** 知识面板数据（god 专属面板；player 视角本人条目）。 */
  knowledge: AvalonKnowledgeEntry[]
  /** 本人任务抉择（仅 player 视角本人可见，AVR-108）。 */
  ownQuestChoices: AvalonQuestChoice[]
  /** 视角可见的待行动者（座位卡待行动高亮数据源）。 */
  pendingActors: string[]
  /** 该视角是否看得见坏人密谋频道（god 或聚焦玩家本人是坏人）。 */
  seesEvilChannel: boolean
}

function computePendingActors(acc: AvalonV2Accumulator, perspective: AvalonPerspective, focusPlayerId: string | null): string[] {
  if (acc.ended) return []
  const allPlayers = acc.seats.map((seat) => seat.playerId)
  // 有效轮次：leaderAssigned 会推 round，但讨论阶段先于首轮 leaderAssigned
  // （round 仍为 0）——以最近一条发言的轮次兜底。
  const round = Math.max(acc.round, acc.statements.at(-1)?.round ?? 0)
  switch (acc.phase) {
    case 'discussion': {
      if (!acc.discussionEnabled) return []
      const spoken = new Set(
        acc.statements.filter((entry) => entry.kind === 'discussion' && entry.round === round).map((entry) => entry.speakerId),
      )
      const pending = allPlayers.filter((playerId) => !spoken.has(playerId))
      // 座位序逐人发言：下一个未发言者（AVR-301 speak）。
      return pending.length > 0 ? [pending[0]] : []
    }
    case 'proposal':
      return acc.leaderId ? [acc.leaderId] : []
    case 'teamVote': {
      const voted = new Set(
        acc.voteRecords.filter((record) => record.round === round && record.attempt === acc.attempt).map((record) => record.voterId),
      )
      return allPlayers.filter((playerId) => !voted.has(playerId))
    }
    case 'quest': {
      const team = avalonCurrentTeamOf(acc)
      const played = new Set(acc.questChoices.filter((choice) => choice.round === round).map((choice) => choice.playerId))
      return team.filter((playerId) => !played.has(playerId))
    }
    case 'evilConsultation': {
      const seesChannel = perspective === 'god' || (perspective === 'player' && focusPlayerId !== null && avalonFactionOfRole(acc.roles[focusPlayerId]) === 'evil')
      if (!seesChannel) return []
      const spoken = new Set(
        acc.statements.filter((entry) => entry.kind === 'consultation' && entry.round === round).map((entry) => entry.speakerId),
      )
      return avalonEvilPlayerIdsOf(acc).filter((playerId) => !spoken.has(playerId))
    }
    case 'assassination': {
      if (acc.assassination) return []
      // 指认前的刺杀者身份是秘密：public 视角不点名（仅 god/player-坏人可见）。
      if (perspective === 'public') return []
      return [avalonAssassinOf(acc)].filter((id): id is string => id !== null)
    }
    default:
      return []
  }
}

/** 视角选择器：从全量真相 accumulator 收敛出该视角的可见面。 */
export function deriveAvalonView(
  acc: AvalonV2Accumulator,
  perspective: AvalonPerspective,
  focusPlayerId: string | null,
): AvalonView {
  const revealed = acc.ended !== null
  const focusIsEvil =
    perspective === 'player' && focusPlayerId !== null && avalonFactionOfRole(acc.roles[focusPlayerId]) === 'evil'
  const seesEvilChannel = perspective === 'god' || focusIsEvil

  let visibleRoles: Record<string, AvalonRole> = {}
  if (perspective === 'god') {
    visibleRoles = { ...acc.roles }
  } else if (perspective === 'player' && focusPlayerId) {
    visibleRoles = revealed ? { ...acc.roles } : acc.roles[focusPlayerId] ? { [focusPlayerId]: acc.roles[focusPlayerId] } : {}
  } else if (revealed) {
    visibleRoles = { ...acc.roles }
  }

  const statements: AvalonVisibleStatement[] = acc.statements.map((entry) => ({
    ...entry,
    hidden: entry.kind === 'consultation' && !seesEvilChannel,
  }))

  const knowledge =
    perspective === 'god'
      ? acc.knowledge
      : perspective === 'player' && focusPlayerId
        ? acc.knowledge.filter((entry) => entry.playerId === focusPlayerId)
        : []

  const ownQuestChoices =
    perspective === 'player' && focusPlayerId ? acc.questChoices.filter((choice) => choice.playerId === focusPlayerId) : []

  return {
    perspective,
    focusPlayerId,
    revealed,
    winner: acc.ended?.winner ?? null,
    visibleRoles,
    statements,
    knowledge,
    ownQuestChoices,
    pendingActors: computePendingActors(acc, perspective, focusPlayerId),
    seesEvilChannel,
  }
}

// ---------------------------------------------------------------------------
// 回放阶段跳转锚点（FR-4.6-02：轮次 + 刺杀环节）
// ---------------------------------------------------------------------------

/**
 * 回放锚点：5 轮任务轮次（leaderAssigned 的 round 首次出现）+ 刺杀环节
 * （evilConsultation / assassination 阶段进入）。输出形状与平台
 * replay-boundaries 的 ReplayBoundary 对齐（kind: hand=轮次 / phase=刺杀环节），
 * 便于主联调时并入 computeReplayBoundaries。
 */
export type AvalonReplayBoundary = { seekIndex: number; label: string; kind: 'hand' | 'phase'; value: number }

export function avalonReplayBoundaries(events: GameEvent[]): AvalonReplayBoundary[] {
  const boundaries: AvalonReplayBoundary[] = []
  let lastRound = 0
  for (const [index, event] of events.entries()) {
    if (!isAvalonV2Event(event)) continue
    const kind = event.kind.slice(AVALON_V2_PREFIX.length)
    if (kind === 'leaderAssigned') {
      const ev = asRecord(event.payload) ?? {}
      const payload = asRecord(ev.payload) ?? {}
      const read = fieldReader(ev, payload)
      const round = read.num('round', 0)
      if (round > lastRound) {
        lastRound = round
        boundaries.push({ seekIndex: index + 1, label: `第 ${round} 轮`, kind: 'hand', value: round })
      }
    } else if (kind === 'phaseEntered') {
      const ev = asRecord(event.payload) ?? {}
      const payload = asRecord(ev.payload) ?? {}
      const read = fieldReader(ev, payload)
      const phase = read.str('phase')
      const round = read.num('round', lastRound)
      if (phase === 'evilConsultation') {
        boundaries.push({ seekIndex: index + 1, label: '刺杀环节 · 密谋', kind: 'phase', value: round })
      } else if (phase === 'assassination') {
        boundaries.push({ seekIndex: index + 1, label: '刺杀环节 · 指认', kind: 'phase', value: round })
      }
    }
  }
  return boundaries
}
