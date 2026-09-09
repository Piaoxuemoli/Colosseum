// Avalon engine v2（R3-2 新品类冒烟规格）— pure logic types & zod schemas.
//
// 「简化阿瓦隆」固定 5 人板（roadmap R3-2，FR-4.5-03 后半 + NFR-08 冒烟）：
//   - 阵营：好人（梅林 / 派西维尔 / 忠诚仆从）vs 坏人（莫德雷德 / 爪牙）
//   - 3 轮任务制，每轮 轮值队长提名 2 人 → 全员表决 →（通过）成员秘密抉择 →
//     公布结果；任一方先拿 2 个任务结果即胜
//   - 简化口径（勿加戏）：无莫甘娜、无双坏必失败、无刺杀梅林、无人出局
//
// 结构镜像 src/games/werewolf/engine2/types.ts（受众模型 / 事件形态 /
// 动作契约 / 结构化拒绝），全部纯 TypeScript + zod，无 React / IO。

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Roles & factions（冒烟板固定 5 人：各 1 张）
// ---------------------------------------------------------------------------

export const avalonRoleIdSchema = z.enum(['merlin', 'percival', 'loyalServant', 'mordred', 'minion'])
export type AvalonRoleId = z.infer<typeof avalonRoleIdSchema>

/** 固定板子（每个角色恰好 1 张，共 5 张）。 */
export const SMOKE_BOARD_ROLES: readonly AvalonRoleId[] = [
  'merlin',
  'percival',
  'loyalServant',
  'mordred',
  'minion',
]

export const factionSchema = z.enum(['good', 'evil'])
export type Faction = z.infer<typeof factionSchema>

export function factionOf(role: AvalonRoleId): Faction {
  return role === 'mordred' || role === 'minion' ? 'evil' : 'good'
}

// ---------------------------------------------------------------------------
// Board constants（冒烟规格锁死，不做配置面）
// ---------------------------------------------------------------------------

export const AVALON_BOARD_ID = 'smoke-5'
export const AVALON_BOARD_SEATS = 5
/** 每轮任务制共 3 轮。 */
export const QUEST_COUNT = 3
/** 每次提名的队伍人数。 */
export const TEAM_SIZE = 2
/** 同一轮第 3 次拒绝 → 该任务直接判失败（防死锁）。 */
export const MAX_REJECTIONS = 3

// ---------------------------------------------------------------------------
// Audience（受众模型：engine2 唯一可见性真相）
// ---------------------------------------------------------------------------

export const audienceSchema = z.union([
  z.object({ kind: z.literal('public') }),
  z.object({ kind: z.literal('delayed-public') }),
  z.object({ kind: z.literal('role-self'), playerId: z.string() }),
])
export type Audience = z.infer<typeof audienceSchema>

// ---------------------------------------------------------------------------
// Actions（冒烟动作空间：proposeTeam / vote / quest）
// ---------------------------------------------------------------------------

export const engineActionSchema = z.discriminatedUnion('type', [
  /** 轮值队长提名 2 人任务队伍（targetIds 恰好 2 个、互异、均在名册内）。 */
  z.object({
    type: z.literal('proposeTeam'),
    actorId: z.string(),
    targetIds: z.array(z.string()).length(TEAM_SIZE),
  }),
  /** 全员队伍表决（approve = 赞成该提案）。 */
  z.object({ type: z.literal('vote'), actorId: z.string(), approve: z.boolean() }),
  /** 队伍成员秘密抉择（好人只能 true；坏人任选）。 */
  z.object({ type: z.literal('quest'), actorId: z.string(), succeed: z.boolean() }),
])
export type AvalonAction = z.infer<typeof engineActionSchema>
export type AvalonActionType = AvalonAction['type']

// ---------------------------------------------------------------------------
// Structured rejection
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
// Phases（proposal → teamVote → quest，循环 3 轮或先到 2 胜）
// ---------------------------------------------------------------------------

export const phaseIdSchema = z.enum(['proposal', 'teamVote', 'quest', 'ended'])
export type PhaseId = z.infer<typeof phaseIdSchema>

// ---------------------------------------------------------------------------
// State（immutable：每一步都是 (state, action) 的纯函数）
// ---------------------------------------------------------------------------

export interface PlayerSlot {
  playerId: string
  /** 1-based 座位号；座位连续 1..5。 */
  seat: number
  role: AvalonRoleId
}

export interface TeamProposal {
  round: number
  /** 本轮第几次提案（1..MAX_REJECTIONS）。 */
  attempt: number
  leaderId: string
  /** 2 名队员（座位序）。 */
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

export interface QuestResultRecord {
  round: number
  outcome: 'success' | 'fail'
  /** 失败票数（autoFailed 时为 0；不点名）。 */
  failVotes: number
  /** 同一轮第 3 次拒绝直接判失败（未进入任务阶段）。 */
  autoFailed: boolean
}

export interface MatchOutcome {
  winner: 'good' | 'evil' | 'tie'
  basis: string
}

export interface AvalonEngineState {
  engineVersion: 2
  players: PlayerSlot[]
  /** 任务轮次（1..QUEST_COUNT；开局事件为 0）。 */
  round: number
  /** 本轮第几次提案（1..MAX_REJECTIONS；每轮重置为 1）。 */
  attempt: number
  phase: PhaseId
  pendingActor: string | null
  /** 轮值队长座位（每次新提案按座位 +1 轮转）。 */
  leaderSeat: number
  proposal: TeamProposal | null
  voteRound: VoteBatch | null
  quest: QuestBatch | null
  results: QuestResultRecord[]
  outcome: MatchOutcome | null
  nextSeq: number
}

// ---------------------------------------------------------------------------
// Events（全部带 audience；day = 轮次计数器 = 通用投影锚点键）
// ---------------------------------------------------------------------------

export interface EventPayloadMap {
  /** 开局配置（公共事实：座位名册 —— 通用投影的名册锚点）。 */
  matchStarted: { board: string; seats: Array<{ playerId: string; seat: number }> }
  /** 随机性溯源（delayed-public：不得在发牌阶段泄露给选手）。 */
  randomnessSeed: { seed: number }
  /** 发牌结果 — 每人一条，audience = 该玩家本人。 */
  rolesAssigned: { role: AvalonRoleId }
  /**
   * 夜间情报 — 仅发给有情报的玩家（梅林见坏人、派西维尔见梅林、坏人互识），
   * audience = 该玩家本人（参照狼人杀 role-self 模式）。
   */
  knowledgeRevealed: {
    insight: 'merlin' | 'percival' | 'evil'
    /** 情报指向的玩家（梅林看到的那名坏人 / 梅林本人 / 另一名坏人）。 */
    playerIds: string[]
  }
  /** 阶段进入 — 每次阶段切换。 */
  phaseEntered: { phase: PhaseId }
  /** 轮值队长指定（公共）。 */
  leaderAssigned: { round: number; attempt: number; leaderId: string }
  /** 队伍提案（公共）。 */
  teamProposed: { round: number; attempt: number; leaderId: string; teamIds: string[] }
  /** 表决个人选择（仅投票人本人可见）。 */
  voteCast: { round: number; attempt: number; voterId: string; approve: boolean }
  /** 表决汇总（公共：计数与结果，不点名）。 */
  voteResult: {
    round: number
    attempt: number
    approvals: number
    rejections: number
    outcome: 'approved' | 'rejected'
  }
  /** 任务成员抉择（仅本人可见；不公布他人）。 */
  questChoice: { round: number; playerId: string; succeed: boolean }
  /** 任务结果（公共：成功/失败与失败票数，不点名）。 */
  questResult: { round: number; outcome: 'success' | 'fail'; failVotes: number; autoFailed: boolean }
  /** 终局揭示（delayed-public：身份全公开）。 */
  gameEnded: {
    winner: 'good' | 'evil' | 'tie'
    basis: string
    reveal: Array<{ playerId: string; seat: number; role: AvalonRoleId }>
  }
}

export type AvalonEventKind = keyof EventPayloadMap

/**
 * Append-only 事实日志条目。`action` 锚在直接映射已提交动作的事件上——
 * 该锚点是 reduceEvents 重放可行的前提（确定性：种子入流）。
 */
export type AvalonEvent = {
  seq: number
  /** 轮次计数器（开局事件为 0；任务轮 1..3）。 */
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
