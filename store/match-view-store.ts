'use client'

import { create } from 'zustand'
import type { GameEvent } from '@/lib/core/types'

export type CardVisual = { rank: string; suit: string }

export type PokerUiPlayer = {
  agentId: string
  displayName: string
  avatarEmoji: string
  seatIndex: number
  chips: number
  currentBet: number
  status: 'active' | 'folded' | 'allIn' | 'eliminated' | 'sittingOut'
  holeCards: CardVisual[]
}

export type MatchViewState = {
  matchId: string
  initialized: boolean
  events: GameEvent[]
  phase: string
  handNumber: number
  currentActor: string | null
  players: PokerUiPlayer[]
  communityCards: CardVisual[]
  pot: number
  dealerIndex: number
  matchComplete: boolean
  winnerAgentId: string | null
  thinkingByAgent: Record<string, string>
  fallbackCount: number
  init(input: { matchId: string; players: PokerUiPlayer[] }): void
  ingestEvent(event: GameEvent): void
  appendThinking(agentId: string, delta: string): void
  clearThinking(agentId: string): void
  setMatchEnd(winnerAgentId: string | null): void
}

const initialState = {
  matchId: '',
  initialized: false,
  events: [] as GameEvent[],
  phase: 'waiting',
  handNumber: 0,
  currentActor: null as string | null,
  players: [] as PokerUiPlayer[],
  communityCards: [] as CardVisual[],
  pot: 0,
  dealerIndex: 0,
  matchComplete: false,
  winnerAgentId: null as string | null,
  thinkingByAgent: {} as Record<string, string>,
  fallbackCount: 0,
}

function cardsFromPayload(payload: Record<string, unknown>): CardVisual[] {
  return Array.isArray(payload.cards) ? (payload.cards as CardVisual[]) : []
}

function actionContribution(action: Record<string, unknown>, player: PokerUiPlayer): number {
  if (typeof action.amount === 'number') return action.amount
  if (typeof action.toAmount === 'number') return Math.max(0, action.toAmount - player.currentBet)
  return 0
}

export const useMatchViewStore = create<MatchViewState>((set) => ({
  ...initialState,

  init(input) {
    set({
      ...initialState,
      matchId: input.matchId,
      initialized: true,
      players: input.players,
      phase: 'preflop',
      handNumber: 1,
    })
  },

  ingestEvent(event) {
    set((state) => {
      let phase = state.phase
      let handNumber = state.handNumber
      let currentActor = state.currentActor
      let communityCards = state.communityCards
      let pot = state.pot
      let matchComplete = state.matchComplete
      let winnerAgentId = state.winnerAgentId
      let thinkingByAgent = state.thinkingByAgent
      const players = state.players.map((player) => ({ ...player }))

      switch (event.kind) {
        case 'poker/match-start':
          handNumber = Math.max(handNumber, 1)
          phase = 'preflop'
          break
        case 'poker/deal-flop':
          phase = 'flop'
          communityCards = [...communityCards, ...cardsFromPayload(event.payload)]
          break
        case 'poker/deal-turn':
          phase = 'turn'
          communityCards = [...communityCards, ...cardsFromPayload(event.payload)]
          break
        case 'poker/deal-river':
          phase = 'river'
          communityCards = [...communityCards, ...cardsFromPayload(event.payload)]
          break
        case 'poker/action': {
          const actorId = event.actorAgentId
          const index = players.findIndex((player) => player.agentId === actorId)
          if (index >= 0) {
            const player = players[index]
            const action = event.payload
            const type = action.type
            const contribution = actionContribution(action, player)
            if (type === 'fold') {
              player.status = 'folded'
            } else if (type === 'allIn') {
              player.status = 'allIn'
              player.chips = 0
              player.currentBet += contribution
              pot += contribution
            } else if (contribution > 0) {
              player.chips = Math.max(0, player.chips - contribution)
              player.currentBet += contribution
              pot += contribution
            }
          }
          if (actorId) {
            thinkingByAgent = { ...thinkingByAgent }
            delete thinkingByAgent[actorId]
          }
          break
        }
        case 'poker/showdown':
          phase = 'showdown'
          currentActor = null
          break
        case 'poker/pot-award': {
          const winnerIds = Array.isArray(event.payload.winnerIds) ? (event.payload.winnerIds as string[]) : []
          const amount = typeof event.payload.potAmount === 'number' ? event.payload.potAmount : pot
          const share = winnerIds.length > 0 ? Math.floor(amount / winnerIds.length) : 0
          for (const winnerId of winnerIds) {
            const index = players.findIndex((player) => player.agentId === winnerId)
            if (index >= 0) players[index].chips += share
          }
          for (const player of players) player.currentBet = 0
          pot = 0
          break
        }
        case 'poker/match-end':
          matchComplete = true
          winnerAgentId = typeof event.payload.winnerId === 'string' ? event.payload.winnerId : null
          currentActor = null
          break
      }

      return {
        events: [...state.events, event],
        phase,
        handNumber,
        currentActor,
        players,
        communityCards,
        pot,
        matchComplete,
        winnerAgentId,
        thinkingByAgent,
      }
    })
  },

  appendThinking(agentId, delta) {
    set((state) => ({
      thinkingByAgent: {
        ...state.thinkingByAgent,
        [agentId]: (state.thinkingByAgent[agentId] ?? '') + delta,
      },
      currentActor: agentId,
    }))
  },

  clearThinking(agentId) {
    set((state) => {
      const thinkingByAgent = { ...state.thinkingByAgent }
      delete thinkingByAgent[agentId]
      return { thinkingByAgent }
    })
  },

  setMatchEnd(winnerAgentId) {
    set({ matchComplete: true, winnerAgentId, currentActor: null })
  },
}))
