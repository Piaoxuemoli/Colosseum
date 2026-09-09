// Avalon engine v2（全量规则，PRD: docs/prd/games/avalon-engine.md v0.1）—
// pure logic types & zod schemas.
//
//   角色池 8 种（AVR-103）· 板子配置驱动 5–10 人（AVR-101）· 5 轮任务 3 胜制
//   （AVR-401/404）· 连续拒绝连坐上限 5（AVR-403）· 好人 3 胜 → 刺杀环节
//   （AVR-106）· 表决公开记名（AVR-107）· 任务抉择保密 + 好人强制成功
//   （AVR-108）· 讨论阶段每轮仅首次提案前（AVR-OD-3a）。
//
// 结构镜像 src/games/werewolf/engine2/types.ts（受众模型 / 事件形态 / 动作
// 契约 / 结构化拒绝），全部纯 TypeScript + zod，无 React / IO。

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Roles & factions（AVR-103 角色能力表）
// ---------------------------------------------------------------------------

export const avalonRoleIdSchema = z.enum([
  // 好人阵营
  'merlin', // 梅林：看到除莫德雷德外的全部坏人；被刺杀目标
  'percival', // 派西维尔：看到梅林与莫甘娜（混排，不可分辨）
  'loyalServant', // 忠诚仆从：无夜间情报
  // 坏人阵营
  'assassin', // 刺客：持刺杀权（无刺客卡时座位序首名坏人代行，AVR-OD-1b）
  'morgana', // 莫甘娜：在派西维尔视野中伪装成梅林
  'mordred', // 莫德雷德：对梅林隐形
  'oberon', // 奥伯伦：自己看到其他坏人，其他坏人看不到他（单向）
  'minion', // 爪牙：无特殊能力
])
export type AvalonRoleId = z.infer<typeof avalonRoleIdSchema>

export const factionSchema = z.enum(['good', 'evil'])
export type Faction = z.infer<typeof factionSchema>

export function factionOf(role: AvalonRoleId): Faction {
  return role === 'merlin' || role === 'percival' || role === 'loyalServant' ? 'good' : 'evil'
}

// ---------------------------------------------------------------------------
// Board configuration（AVR-101 最小字段需求表 + AVR-601 板子表）
// ---------------------------------------------------------------------------

/** 任务轮数（v1 固定 5，不开放配置）。 */
export const QUEST_COUNT = 5
/** 胜利所需任务成功 / 失败数（v1 固定 3 / 3）。 */
export const WINS_REQUIRED = 3
/** 连续拒绝上限（标准口径 5；第 5 次拒绝 → 坏人直接胜，AVR-403）。 */
export const MAX_REJECTIONS = 5
/** 发言 / 合议文本长度域（AVR-301：1–2000 字）。 */
export const TEXT_MIN_LENGTH = 1
export const TEXT_MAX_LENGTH = 2000

/** 标准人数板子表（AVR-601：阵营配比与任务人数的权威出处）。 */
export const STANDARD_BOARD_TABLE: ReadonlyArray<{
  seats: number
  good: number
  evil: number
  teamSizes: readonly number[]
}> = [
  { seats: 5, good: 3, evil: 2, teamSizes: [2, 3, 2, 3, 3] },
  { seats: 6, good: 4, evil: 2, teamSizes: [2, 3, 4, 3, 4] },
  { seats: 7, good: 4, evil: 3, teamSizes: [2, 3, 3, 4, 4] },
  { seats: 8, good: 5, evil: 3, teamSizes: [3, 4, 4, 5, 5] },
  { seats: 9, good: 6, evil: 3, teamSizes: [3, 4, 4, 5, 5] },
  { seats: 10, good: 6, evil: 4, teamSizes: [3, 4, 4, 5, 5] },
]

/** 板子座位数取值域。 */
export const MIN_SEATS = 5
export const MAX_SEATS = 10

/** 解析后的板子配置（对局的单一真相；预设与自定义配置同形）。 */
export interface ResolvedBoard {
  /** 板子标识（预设 id 或 'custom'）。 */
  id: string
  /** 人类可读板名。 */
  name: string
  /** 角色构成 {角色: 数量}；总和 = 座位数。 */
  roles: Partial<Record<AvalonRoleId, number>>
  /** 每轮任务人数表（长度 = QUEST_COUNT）。 */
  teamSizes: number[]
  /** 双失败轮（仅允许 > 1 的轮次；这些轮 requiredFails = 2）。 */
  doubleFailRounds: number[]
  /** 讨论阶段开关（默认开，AVR-301 / AVR-OD-3a）。 */
  discussionEnabled: boolean
}

/** 预设定义（AVR-601 内置板子；resolveBoard 后成为 ResolvedBoard）。 */
export interface BoardPreset {
  id: string
  name: string
  roles: Partial<Record<AvalonRoleId, number>>
  teamSizes: number[]
  doubleFailRounds: number[]
  discussionEnabled?: boolean
}

// ---------------------------------------------------------------------------
// Audience（AVR-201：受众标记是唯一可见性真相）
// ---------------------------------------------------------------------------

export const audienceSchema = z.union([
  z.object({ kind: z.literal('public') }),
  z.object({ kind: z.literal('delayed-public') }),
  z.object({ kind: z.literal('role-self'), playerId: z.string() }),
])
export type Audience = z.infer<typeof audienceSchema>

// ---------------------------------------------------------------------------
// Actions（AVR-301 动作空间：speak / proposeTeam / vote / quest / consult / assassinate）
// ---------------------------------------------------------------------------

export const engineActionSchema = z.discriminatedUnion('type', [
  /** 讨论阶段公开发言（座位序逐人；文本 1–2000 字，载荷透传）。 */
  z.object({ type: z.literal('speak'), actorId: z.string(), text: z.string() }),
  /** 轮值队长提名任务队伍（targetIds 恰好 N 人、互异、均在名册内）。 */
  z.object({
    type: z.literal('proposeTeam'),
    actorId: z.string(),
    targetIds: z.array(z.string()).min(1),
  }),
  /** 全员队伍表决（公开记名，AVR-107）。 */
  z.object({ type: z.literal('vote'), actorId: z.string(), approve: z.boolean() }),
  /** 队伍成员秘密出牌（好人只能 true，AVR-108）。 */
  z.object({ type: z.literal('quest'), actorId: z.string(), succeed: z.boolean() }),
  /** 刺杀合议发言（仅坏人可见；文本 1–2000 字）。 */
  z.object({ type: z.literal('consult'), actorId: z.string(), text: z.string() }),
  /** 刺杀指认（目标 1 人、非本人）。 */
  z.object({ type: z.literal('assassinate'), actorId: z.string(), targetId: z.string() }),
])
export type AvalonAction = z.infer<typeof engineActionSchema>
export type AvalonActionType = AvalonAction['type']

// ---------------------------------------------------------------------------
// Structured rejection（AVR-302）
// ---------------------------------------------------------------------------

export const rejectionCodeSchema = z.enum([
  'WRONG_PHASE',
  'WRONG_ACTOR',
  'ILLEGAL_TARGET',
  'ILLEGAL_CHOICE',
  'PARAM_CONFLICT',
  'UNPARSEABLE',
])
export type RejectionCode = z.infer<typeof rejectionCodeSchema>

export interface ActionRejection {
  code: RejectionCode
  message: string
  context: {
    round: number
    phase: PhaseId
    actorId: string
    actionType: string
  }
}

// ---------------------------------------------------------------------------
// Phases（AVR-102 阶段机：讨论 → 提名 → 表决 → 任务 →（好人 3 胜）合议 → 刺杀）
// ---------------------------------------------------------------------------

export const phaseIdSchema = z.enum([
  'discussion',
  'proposal',
  'teamVote',
  'quest',
  'evilConsultation',
  'assassination',
  'ended',
])
export type PhaseId = z.infer<typeof phaseIdSchema>

// ---------------------------------------------------------------------------
// State（不可变：每一步都是 (state, action) 的纯函数）
// ---------------------------------------------------------------------------

export interface PlayerSlot {
  playerId: string
  /** 1-based 座位号；座位连续 1..N。 */
  seat: number
  role: AvalonRoleId
}

export interface TeamProposal {
  round: number
  /** 本轮第几次提案（1..MAX_REJECTIONS）。 */
  attempt: number
  leaderId: string
  /** 队员（座位序）。 */
  teamIds: string[]
}

export interface VoteBatch {
  round: number
  attempt: number
  /** 座位序待投票队列（队首 = pendingActor）。 */
  queue: string[]
  cast: Array<{ voterId: string; approve: boolean }>
}

export interface QuestBatch {
  round: number
  teamIds: string[]
  /** 座位序待抉择队列（队首 = pendingActor）。 */
  queue: string[]
  choices: Array<{ playerId: string; succeed: boolean }>
}

export interface DiscussionBatch {
  round: number
  /** 座位序待发言队列（队首 = pendingActor）。 */
  queue: string[]
}

export interface ConsultationBatch {
  /** 座位序待合议的坏人队列（队首 = pendingActor）。 */
  queue: string[]
}

export interface QuestResultRecord {
  round: number
  outcome: 'success' | 'fail'
  /** 失败牌张数（结果只公布张数，不点名，AVR-108）。 */
  failVotes: number
  /** 本轮判失败所需张数（普通轮 1 / 双失败轮 2，AVR-402）。 */
  requiredFails: number
}

export interface VoteHistoryEntry {
  round: number
  attempt: number
  /** 座位序全量记名投票（AVR-107 公开口径）。 */
  cast: Array<{ voterId: string; approve: boolean }>
}

export interface KnowledgeRecord {
  playerId: string
  insight: 'merlin' | 'percival' | 'evil'
  /** 情报指向的玩家（混排不标注真伪，AVR-203）。 */
  playerIds: string[]
}

export interface AssassinationRecord {
  assassinId: string
  targetId: string
  hitMerlin: boolean
}

export interface MatchOutcome {
  winner: 'good' | 'evil' | 'tie'
  basis: string
}

export interface AvalonEngineState {
  engineVersion: 2
  board: ResolvedBoard
  players: PlayerSlot[]
  /** 任务轮次（1..QUEST_COUNT；开局事件为 0）。 */
  round: number
  /** 本轮第几次提案（1..MAX_REJECTIONS；每轮重置为 1）。 */
  attempt: number
  phase: PhaseId
  pendingActor: string | null
  /** 轮值队长座位（每次新提案按座位 +1 轮转；首任队长由种子决定）。 */
  leaderSeat: number
  discussion: DiscussionBatch | null
  proposal: TeamProposal | null
  voteRound: VoteBatch | null
  quest: QuestBatch | null
  consultation: ConsultationBatch | null
  results: QuestResultRecord[]
  /** 公开记名投票史（AVR-107：决策上下文的公开事实子集）。 */
  voteHistory: VoteHistoryEntry[]
  /** 发言史摘要（speakerId 序列；全文由事件流承担）。 */
  statementLog: string[]
  /** 夜间情报（发牌时算定；事件与决策上下文同源，AVR-203）。 */
  knowledge: KnowledgeRecord[]
  /** 刺杀裁决事实（assassinationDeclared 后非空）。 */
  assassination: AssassinationRecord | null
  outcome: MatchOutcome | null
  nextSeq: number
}

// ---------------------------------------------------------------------------
// Events（AVR-502 最小事件集 15 种；day = 轮次计数器 = 通用投影锚点键）
// ---------------------------------------------------------------------------

export interface EventPayloadMap {
  /** #1 开局配置（公共：板子摘要 + 座位名册 + 公开板面参数）。 */
  matchStarted: {
    boardId: string
    boardName: string
    seats: Array<{ playerId: string; seat: number }>
    questCount: number
    teamSizes: number[]
    doubleFailRounds: number[]
    discussionEnabled: boolean
    roles: Partial<Record<AvalonRoleId, number>>
  }
  /** 随机性溯源（delayed-public：终局前不得泄露给选手）。 */
  randomnessSeed: { seed: number }
  /** #3 开局发牌 — 每人一条，audience = 该玩家本人。 */
  rolesAssigned: { role: AvalonRoleId }
  /** #4 夜间情报 — 仅有情报的玩家收到（AVR-203 知识矩阵）。 */
  knowledgeRevealed: {
    insight: 'merlin' | 'percival' | 'evil'
    playerIds: string[]
  }
  /** #5 阶段进入 — 每次阶段切换。 */
  phaseEntered: { phase: PhaseId }
  /** #6 轮值队长指定（公共）。 */
  leaderAssigned: { round: number; attempt: number; leaderId: string }
  /** #7 讨论阶段公开发言。 */
  statementIssued: { speakerId: string; text: string }
  /** #8 刺杀合议 — 每条合议发给全部坏人各自 role-self 副本（坏人互见）。 */
  evilConsulted: { speakerId: string; text: string }
  /** #9 队伍提案（公共）。 */
  teamProposed: { round: number; attempt: number; leaderId: string; teamIds: string[] }
  /** #10 公开记名表决（AVR-107 口径变更：立场与身份一同公开）。 */
  voteCast: { round: number; attempt: number; voterId: string; approve: boolean }
  /** #11 表决汇总（公共：赞成严格 > 反对才通过；平票 = 否决）。 */
  voteResult: {
    round: number
    attempt: number
    approvals: number
    rejections: number
    outcome: 'approved' | 'rejected'
  }
  /** #12 任务成员抉择（仅本人可见）。 */
  questChoice: { round: number; playerId: string; succeed: boolean }
  /** #13 任务结果（公共：结果 + 失败张数 + 阈值；不点名）。 */
  questResult: { round: number; outcome: 'success' | 'fail'; failVotes: number; requiredFails: number }
  /** #14 刺杀指认（公共）。 */
  assassinationDeclared: { assassinId: string; targetId: string }
  /** #15 终局揭示（delayed-public：胜方 + 依据 + 全员身份）。 */
  gameEnded: {
    winner: 'good' | 'evil' | 'tie'
    basis: string
    reveal: Array<{ playerId: string; seat: number; role: AvalonRoleId }>
  }
}

export type AvalonEventKind = keyof EventPayloadMap

/**
 * Append-only 事实日志条目（AVR-501/504）。`action` 锚在直接映射已提交动作
 * 的事件上——该锚点是 reduceEvents 重放可行的前提（确定性：种子入流）。
 */
export type AvalonEvent = {
  seq: number
  /** 轮次计数器（开局事件为 0；任务轮 1..5）。 */
  day: number
  audience: Audience
  actorId: string | null
  isDefault?: boolean
  action?: AvalonAction
} & {
  [K in keyof EventPayloadMap]: { kind: K; payload: EventPayloadMap[K] }
}[keyof EventPayloadMap]

// ---------------------------------------------------------------------------
// Engine results
// ---------------------------------------------------------------------------

export type ApplyOutcome =
  | { status: 'accepted'; state: AvalonEngineState; events: AvalonEvent[] }
  | { status: 'rejected'; rejection: ActionRejection }

export type CreateMatchResult =
  | { status: 'created'; state: AvalonEngineState; events: AvalonEvent[] }
  | { status: 'invalid'; issues: Array<{ field: string; code: string; message: string }> }

/** 机器可读动作契约（上游适配器 / legalActions 包装）。 */
export interface ActionOption {
  type: AvalonActionType
  label: string
  /** 可选目标 / 选项（proposeTeam = 全体；vote = approve/reject；quest = success[/fail]）。 */
  targetIds: string[]
  allowNone: boolean
}
