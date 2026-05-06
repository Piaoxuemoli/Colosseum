import { z } from 'zod'
import type { Card } from './card'

export const pokerPhaseSchema = z.enum(['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown', 'handComplete'])
export type PokerPhase = z.infer<typeof pokerPhaseSchema>

export const pokerPlayerStatusSchema = z.enum(['active', 'folded', 'allIn', 'eliminated', 'sittingOut'])
export type PokerPlayerStatus = z.infer<typeof pokerPlayerStatusSchema>

export const pokerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fold') }),
  z.object({ type: z.literal('check') }),
  z.object({ type: z.literal('call'), amount: z.number().nonnegative() }),
  z.object({ type: z.literal('bet'), amount: z.number().positive() }),
  z.object({ type: z.literal('raise'), toAmount: z.number().positive() }),
  z.object({ type: z.literal('allIn'), amount: z.number().positive() }),
  z.object({ type: z.literal('postSmallBlind'), amount: z.number().positive() }),
  z.object({ type: z.literal('postBigBlind'), amount: z.number().positive() }),
])
export type PokerAction = z.infer<typeof pokerActionSchema>

export interface PokerPlayerState {
  id: string
  seatIndex: number
  chips: number
  holeCards: Card[]
  status: PokerPlayerStatus
  currentBet: number
  totalCommitted: number
  hasActedThisStreet: boolean
}

export interface PokerActionRecord {
  seq: number
  phase: Exclude<PokerPhase, 'waiting' | 'handComplete'>
  agentId: string
  action: PokerAction
}

export interface PokerConfig {
  smallBlind: number
  bigBlind: number
  startingChips: number
  maxBetsPerStreet: number
}

export interface PokerState {
  phase: PokerPhase
  handNumber: number
  dealerIndex: number
  players: PokerPlayerState[]
  communityCards: Card[]
  currentActor: string | null
  actionHistory: PokerActionRecord[]
  betsThisStreet: number
  smallBlind: number
  bigBlind: number
  handComplete: boolean
  matchComplete: boolean
  deck: Card[]
}
