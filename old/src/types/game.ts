import type { Card } from './card'
import type { Player } from './player'
import type { PlayerAction } from './action'

export type GamePhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'

export interface SidePot {
  amount: number
  eligiblePlayerIds: string[]
}

export interface TimingConfig {
  /** Minimum action interval in ms, default 1500 */
  minActionInterval: number
  /** LLM thinking timeout in ms, default 30000 */
  thinkingTimeout: number
}

export interface GameState {
  id: string
  phase: GamePhase
  communityCards: Card[]
  pot: number
  sidePots: SidePot[]
  players: Player[]
  /** Dealer position — stores seatIndex (0-5), not players array index */
  dealerIndex: number
  /** Current acting player — stores seatIndex (0-5), not players array index */
  currentPlayerIndex: number
  /** 小注 (Small Bet)，有限注下注单位。小盲 = smallBlind/2，大盲 = smallBlind */
  smallBlind: number
  /** 大注 (Big Bet) = 小注 × 2，转牌/河牌下注单位 */
  bigBlind: number
  /** 当前街固定下注单位 (Fixed-Limit) */
  minRaise: number
  deck: Card[]
  actionHistory: PlayerAction[]
  handNumber: number
  /** Session identifier for grouping hands */
  sessionId: string
  /** Timing configuration for action intervals and LLM timeout */
  timingConfig: TimingConfig
}
