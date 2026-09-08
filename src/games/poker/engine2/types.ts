// 引擎 v2 类型与 zod 契约（PFR-102 配置 / PFR-205 动作 / PFR-3xx 状态 / PFR-503 拒绝）。
// 本文件只含类型与校验 schema，不含任何逻辑。

import { z } from 'zod'
import type { Card } from './cards'

// ---------------------------------------------------------------------------
// 配置（PFR-102、PFR-104：v1 仅 no-limit；OD-P2：手数制升级、无 ante）
// ---------------------------------------------------------------------------

export const blindLevelSchema = z
  .object({ sb: z.number().int().positive(), bb: z.number().int().positive() })
  .refine((v) => v.sb < v.bb, { message: 'SB 必须小于 BB' })
export type BlindLevel = z.infer<typeof blindLevelSchema>

/** 升级计划：levels[0] 为初始级，必须与 config.blinds 一致（语义校验）。 */
export const blindScheduleSchema = z.object({
  handsPerLevel: z.number().int().positive(),
  levels: z.array(blindLevelSchema).min(1),
})
export type BlindSchedule = z.infer<typeof blindScheduleSchema>

export const matchConfigSchema = z.object({
  /** 座位顺序 = 数组顺序（顺时针）；2–9 人（PFR-102）。 */
  seatIds: z.array(z.string().min(1)).min(2).max(9),
  /** 起始筹码：正整数，全员相同（PFR-101/102）。 */
  startingStack: z.number().int().positive(),
  blinds: blindLevelSchema,
  /** 升级计划可禁用（默认禁用 = 固定盲注，PFR-102/212）。 */
  schedule: blindScheduleSchema.optional(),
})
export type MatchConfigInput = z.infer<typeof matchConfigSchema>

export interface ResolvedMatchConfig {
  readonly seatIds: readonly string[]
  readonly startingStack: number
  readonly initialBlinds: BlindLevel
  readonly schedule: BlindSchedule | null
}

export type ConfigRejectionCode =
  | 'INVALID_CONFIG_SHAPE'
  | 'DUPLICATE_SEAT_ID'
  | 'SCHEDULE_LEVEL_MISMATCH'

export interface ConfigRejection {
  code: ConfigRejectionCode
  message: string
}

export type ConfigOutcome =
  | { ok: true; config: ResolvedMatchConfig }
  | { ok: false; rejection: ConfigRejection }

// ---------------------------------------------------------------------------
// 动作（PFR-205：fold / check / call / bet / raise / all-in）
// ---------------------------------------------------------------------------

export const playerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fold') }),
  z.object({ type: z.literal('check') }),
  z.object({ type: z.literal('call') }),
  z.object({ type: z.literal('bet'), amount: z.number().int().positive() }),
  z.object({ type: z.literal('raise'), toAmount: z.number().int().positive() }),
  z.object({ type: z.literal('all-in') }),
])
export type PlayerAction = z.infer<typeof playerActionSchema>

/**
 * 规范化动作：引擎校验通过后的唯一事实形态，也是 action-made 事件的载荷
 * （reduceEvents 依据它重放，PFR-405）。
 * bet/raise 的金额一律为"加到额"（streetBet 目标值）。
 */
export type NormalizedAction =
  | { type: 'fold'; seatId: string }
  | { type: 'check'; seatId: string }
  | { type: 'call'; seatId: string; paid: number; allIn: boolean }
  | { type: 'bet'; seatId: string; to: number; paid: number; allIn: boolean; reopens: boolean }
  | {
      type: 'raise'
      seatId: string
      to: number
      paid: number
      increment: number
      allIn: boolean
      /** 是否构成完整加注（增量 ≥ 最近完整加注增量），决定是否重开行动（PFR-206）。 */
      reopens: boolean
    }

export const normalizedActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fold'), seatId: z.string() }),
  z.object({ type: z.literal('check'), seatId: z.string() }),
  z.object({ type: z.literal('call'), seatId: z.string(), paid: z.number(), allIn: z.boolean() }),
  z.object({
    type: z.literal('bet'),
    seatId: z.string(),
    to: z.number(),
    paid: z.number(),
    allIn: z.boolean(),
    reopens: z.boolean(),
  }),
  z.object({
    type: z.literal('raise'),
    seatId: z.string(),
    to: z.number(),
    paid: z.number(),
    increment: z.number(),
    allIn: z.boolean(),
    reopens: z.boolean(),
  }),
])

// ---------------------------------------------------------------------------
// 非法动作结构化拒绝（PFR-207 / PFR-503）
// ---------------------------------------------------------------------------

export type RejectionCode =
  | 'MATCH_ALREADY_FINISHED'
  | 'NOT_CURRENT_ACTOR'
  | 'ACTION_TYPE_UNAVAILABLE'
  | 'AMOUNT_BELOW_MIN'
  | 'AMOUNT_ABOVE_MAX'
  | 'BELOW_MIN_RAISE_NOT_ALL_IN'
  | 'INVALID_AMOUNT'

export interface ActionRejection {
  code: RejectionCode
  message: string
  /** 当前合法动作集（供平台层容错链使用，PFR-503）。 */
  legalActions?: readonly unknown[]
  minTo?: number
  maxTo?: number
  currentActor?: string
}

// ---------------------------------------------------------------------------
// 状态（PFR-301：不可变、可序列化、纯函数推进）
// ---------------------------------------------------------------------------

export type PlayerStatus = 'active' | 'folded' | 'all-in' | 'eliminated'
export type Street = 'preflop' | 'flop' | 'turn' | 'river'

export interface PlayerState {
  seatId: string
  /** 物理座位号 = config.seatIds 数组下标。 */
  seat: number
  /** 桌面筹码（不含当街已下注额）。 */
  stack: number
  status: PlayerStatus
  holeCards: Card[]
  /** 本街已投入（街切换时清零）。 */
  streetBet: number
  /** 本手累计贡献（边池分层依据，PFR-208）。 */
  totalCommitted: number
  hasActed: boolean
  revealed: boolean
  /** 出局名次（1 = 冠军；null = 未出局）。 */
  rank: number | null
}

export interface HandFrame {
  handNumber: number
  handSeed: number
  /** 剩余牌堆（底牌已发出；烧牌省略，PFR-203）。 */
  deck: Card[]
  board: Card[]
  street: Street
  buttonSeat: number
  sbSeat: number
  bbSeat: number
  /** 本街最高下注额（"加到"口径）。 */
  currentBet: number
  /** 最近一次完整 bet/raise 的增量（PFR-206）；preflop 初始 = BB，postflop 初始 = 0。 */
  lastRaiseIncrement: number
  /** 本街最后进攻者座位（摊牌亮牌顺序锚点，PFR-209）。 */
  lastAggressorSeat: number | null
  /** 各座位开手筹码快照（盈亏摘要与同手出局排序依据）。 */
  startStacks: number[]
}

export type MatchPhase = 'awaiting-action' | 'between-hands' | 'finished'

export type MatchFinishReason = 'natural' | 'controlled-after-hand' | 'controlled-immediate'

export interface MatchFinish {
  reason: MatchFinishReason
  ranking: ReadonlyArray<{ seatId: string; rank: number; chips: number }>
  /** 受控终止时点（引擎不感知时间，以 seq + 手号为时点，PFR-105）。 */
  terminatedAt: { seq: number; hand: number } | null
}

export interface MatchState {
  /** 已产出事件数（事件 seq 与之恒等，PFR-401）。 */
  seq: number
  config: ResolvedMatchConfig
  masterSeed: number
  phase: MatchPhase
  currentActor: string | null
  players: PlayerState[]
  hand: HandFrame | null
  /** 最近已开始的手号；0 = 尚未开始。 */
  handNumber: number
  level: number
  blinds: BlindLevel
  stopAfterHand: boolean
  finish: MatchFinish | null
}
