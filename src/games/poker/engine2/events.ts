// 事件契约（PFR-401/402/403/405）：
// - 每个事件是不可变增量事实，seq 对局内单调递增无空洞；
// - 事件不内嵌全量状态快照；
// - 受众三级：public / self:<seat> / delayed-public；
// - PFR-403 上帝视角：显式授权的全量信息投影通道（selector: 'god'），
//   不改变三级默认可见性。

import type { Card } from './cards'
import type { BlindLevel, BlindSchedule, MatchFinishReason, NormalizedAction, Street } from './types'

export type EventAudience =
  | { kind: 'public' }
  | { kind: 'self'; seatId: string }
  | { kind: 'delayed-public' }

export interface EventBase {
  /** 对局内单调递增，无空洞（PFR-401）。 */
  seq: number
  /** 手号；对局级事件为 0。 */
  hand: number
  audience: EventAudience
}

export interface MatchConfigEvent extends EventBase {
  kind: 'match-config'
  seatIds: string[]
  startingStack: number
  blinds: BlindLevel
  schedule: BlindSchedule | null
}

/** 初始随机性材料（master 种子），延迟公开（PFR-404）。 */
export interface RandomnessEstablishedEvent extends EventBase {
  kind: 'randomness-established'
  masterSeed: number
}

export interface HandStartedEvent extends EventBase {
  kind: 'hand-started'
  handNumber: number
  buttonSeat: number
  sbSeat: number
  bbSeat: number
  headsUp: boolean
  blinds: BlindLevel
  level: number
}

/** 每手洗牌随机性（该手种子，可复现该手牌序），延迟公开（PFR-404）。 */
export interface DeckShuffledEvent extends EventBase {
  kind: 'deck-shuffled'
  seed: number
}

/** 底牌发放：仅本人（PFR-403）。 */
export interface HoleCardsDealtEvent extends EventBase {
  kind: 'hole-cards-dealt'
  seatId: string
  cards: Card[]
}

export interface BlindsPostedEvent extends EventBase {
  kind: 'blinds-posted'
  posts: ReadonlyArray<{
    seatId: string
    blind: 'sb' | 'bb'
    due: number
    posted: number
    allIn: boolean
  }>
}

export interface StreetDealtEvent extends EventBase {
  kind: 'street-dealt'
  street: 'flop' | 'turn' | 'river'
  cards: Card[]
  /** run-out 自动发牌标记（PFR-402）。 */
  auto: boolean
}

export interface RunOutStartedEvent extends EventBase {
  kind: 'run-out-started'
}

/** 亮牌揭示（带顺序）：揭示时刻起公共（PFR-209）。 */
export interface CardsRevealedEvent extends EventBase {
  kind: 'cards-revealed'
  seatId: string
  cards: Card[]
}

export interface PotAwardedEvent extends EventBase {
  kind: 'pot-awarded'
  potIndex: number
  amount: number
  eligibleSeatIds: string[]
  winners: ReadonlyArray<{ seatId: string; baseShare: number; oddChips: number; total: number }>
}

export interface HandEndedEvent extends EventBase {
  kind: 'hand-ended'
  handNumber: number
  results: ReadonlyArray<{
    seatId: string
    startStack: number
    endStack: number
    delta: number
    eliminated: boolean
  }>
}

export interface BlindLevelRaisedEvent extends EventBase {
  kind: 'blind-level-raised'
  level: number
  blinds: BlindLevel
}

export interface PlayerEliminatedEvent extends EventBase {
  kind: 'player-eliminated'
  seatId: string
  rank: number
}

export interface MatchFinishedEvent extends EventBase {
  kind: 'match-finished'
  reason: MatchFinishReason
  ranking: ReadonlyArray<{ seatId: string; rank: number; chips: number }>
  terminatedAt: { seq: number; hand: number } | null
}

export interface StopRequestedEvent extends EventBase {
  kind: 'stop-requested'
}

export interface ActionMadeEvent extends EventBase {
  kind: 'action-made'
  seatId: string
  street: Street
  /** 规范化动作（唯一事实形态，重放依据）。 */
  action: NormalizedAction
}

export type PokerEvent =
  | MatchConfigEvent
  | RandomnessEstablishedEvent
  | HandStartedEvent
  | DeckShuffledEvent
  | HoleCardsDealtEvent
  | BlindsPostedEvent
  | StreetDealtEvent
  | RunOutStartedEvent
  | CardsRevealedEvent
  | PotAwardedEvent
  | HandEndedEvent
  | BlindLevelRaisedEvent
  | PlayerEliminatedEvent
  | MatchFinishedEvent
  | StopRequestedEvent
  | ActionMadeEvent

type WithoutSeq<E> = E extends { seq: number } ? Omit<E, 'seq'> : never
export type EventDraft = WithoutSeq<PokerEvent>

// ---------------------------------------------------------------------------
// 按受众投影（PFR-402/403）
// ---------------------------------------------------------------------------

export type EventAudienceSelector =
  | 'spectator'
  | 'auditor'
  /** PFR-403：显式授权的上帝视角通道，仅供观战呈现层消费。 */
  | 'god'
  | { seat: string }

/**
 * 事件投影：
 * - public：全员可见；
 * - self:<seat>：仅本人、审计与上帝视角可见；
 * - delayed-public：审计与上帝视角即时可见；观众与其他选手在该手结算后可见
 *   （以流中其后是否存在同手号的 hand-ended 事件判定）。
 */
export function filterEvents(events: readonly PokerEvent[], selector: EventAudienceSelector): PokerEvent[] {
  const isPrivileged = selector === 'auditor' || selector === 'god'
  const seatId = typeof selector === 'object' ? selector.seat : null

  // 延迟公开可见性：某手已结算 = 流中存在该手的 hand-ended 事件
  const settledHands = new Set<number>()
  for (const ev of events) {
    if (ev.kind === 'hand-ended') settledHands.add(ev.hand)
  }

  return events.filter((ev) => {
    if (ev.audience.kind === 'public') return true
    if (ev.audience.kind === 'self') {
      return isPrivileged || ev.audience.seatId === seatId
    }
    // delayed-public
    if (isPrivileged) return true
    return settledHands.has(ev.hand)
  })
}
