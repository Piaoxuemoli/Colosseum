import type { Card } from './card'
import type { PlayerAction } from './action'
import type { SidePot } from './game'
import type { PlayerType, StructuredImpression } from './player'

export interface PlayerSnapshot {
  id: string
  name: string
  type: PlayerType
  seatIndex: number
  chips: number           // chips at hand start
  chipsAfter: number      // chips after hand ends
  holeCards: Card[]
  finalStatus: string
}

export interface StreetRecord {
  actions: PlayerAction[]
  cards?: Card[]
}

export interface WinnerRecord {
  playerId: string
  amount: number
  handRank: string
  winningCards: Card[]
}

export interface HandHistory {
  id: string
  handNumber: number
  timestamp: number
  smallBlind: number
  bigBlind: number
  players: PlayerSnapshot[]
  communityCards: Card[]
  streets: {
    preflop: StreetRecord
    flop: StreetRecord
    turn: StreetRecord
    river: StreetRecord
  }
  winners: WinnerRecord[]
  pot: number
  sidePots: SidePot[]
  /** Session this hand belongs to */
  sessionId: string
  /** LLM thinking content per player: playerId -> thinking text */
  llmThoughts: Record<string, string>
  /** LLM impressions snapshot: playerId -> { targetPlayerId: StructuredImpression } */
  llmImpressions: Record<string, Record<string, StructuredImpression>>
}
