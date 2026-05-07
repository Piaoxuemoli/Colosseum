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

export type ChipSnapshot = {
  handNumber: number
  at: number
  chips: Record<string, number>
}

export type WerewolfSpeechEntry = {
  day: number
  agentId: string
  content: string
  claimedRole?: string
}

export type WerewolfVoteEntry = {
  day: number
  voter: string
  target: string | null
  reason?: string
}

export type WerewolfNarrationEntry = {
  day: number
  phase: string
  narration: string
}

export type WerewolfDerived = {
  day: number
  phase: string | null
  speechLog: WerewolfSpeechEntry[]
  voteLog: WerewolfVoteEntry[]
  moderatorNarration: WerewolfNarrationEntry[]
  roleAssignments: Record<string, string> | null
  winner: 'werewolves' | 'villagers' | 'tie' | null
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
  status: 'waiting' | 'live' | 'settled'
  matchComplete: boolean
  winnerAgentId: string | null
  thinkingByAgent: Record<string, string>
  fallbackCount: number
  chipHistory: ChipSnapshot[]
  errorCount: number
  werewolf: WerewolfDerived
  reset(): void
  init(input: { matchId: string; players: PokerUiPlayer[] }): void
  ingestEvent(event: GameEvent): void
  appendThinking(agentId: string, delta: string): void
  clearThinking(agentId: string): void
  setMatchEnd(winnerAgentId: string | null): void
  recordHandSnapshot(handNumber: number, chips: Record<string, number>): void
  incrementError(): void
  setErrorCount(count: number): void
}

const initialWerewolf: WerewolfDerived = {
  day: 0,
  phase: null,
  speechLog: [],
  voteLog: [],
  moderatorNarration: [],
  roleAssignments: null,
  winner: null,
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
  status: 'waiting' as const,
  matchComplete: false,
  winnerAgentId: null as string | null,
  thinkingByAgent: {} as Record<string, string>,
  fallbackCount: 0,
  chipHistory: [] as ChipSnapshot[],
  errorCount: 0,
  werewolf: initialWerewolf,
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

  reset() {
    set({ ...initialState })
  },

  init(input) {
    set({
      ...initialState,
      matchId: input.matchId,
      initialized: true,
      players: input.players,
      phase: 'preflop',
      handNumber: 1,
      status: 'live',
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
      let status = state.status
      let chipHistory = state.chipHistory
      let errorCount = state.errorCount
      let werewolf = state.werewolf
      const players = state.players.map((player) => ({ ...player }))

      switch (event.kind) {
        case 'agent_error':
          errorCount += 1
          break
        case 'poker/match-start':
          handNumber = Math.max(handNumber, 1)
          phase = 'preflop'
          status = 'live'
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
          chipHistory = [
            ...chipHistory,
            {
              handNumber,
              at: Date.now(),
              chips: Object.fromEntries(players.map((player) => [player.agentId, player.chips])),
            },
          ]
          break
        }
        case 'poker/match-end':
        case 'match_end':
        case 'settlement':
          matchComplete = true
          status = 'settled'
          winnerAgentId = typeof event.payload.winnerId === 'string' ? event.payload.winnerId : null
          currentActor = null
          break
        case 'werewolf/moderator-narrate': {
          const day = typeof event.payload.day === 'number' ? event.payload.day : werewolf.day
          const upcomingPhase =
            typeof event.payload.upcomingPhase === 'string' ? event.payload.upcomingPhase : werewolf.phase
          const narration =
            typeof event.payload.narration === 'string' ? event.payload.narration : ''
          werewolf = {
            ...werewolf,
            day,
            phase: upcomingPhase,
            moderatorNarration: [
              ...werewolf.moderatorNarration,
              { day, phase: upcomingPhase ?? '', narration },
            ],
          }
          break
        }
        case 'werewolf/speak': {
          const actorId = event.actorAgentId
          if (!actorId) break
          const day = typeof event.payload.day === 'number' ? event.payload.day : werewolf.day
          const content =
            typeof event.payload.content === 'string' ? event.payload.content : ''
          const claimedRole =
            typeof event.payload.claimedRole === 'string' ? event.payload.claimedRole : undefined
          werewolf = {
            ...werewolf,
            speechLog: [...werewolf.speechLog, { day, agentId: actorId, content, claimedRole }],
          }
          break
        }
        case 'werewolf/vote': {
          const actorId = event.actorAgentId
          if (!actorId) break
          const day = typeof event.payload.day === 'number' ? event.payload.day : werewolf.day
          const target =
            typeof event.payload.target === 'string' ? event.payload.target : null
          const reason =
            typeof event.payload.reason === 'string' ? event.payload.reason : undefined
          werewolf = {
            ...werewolf,
            voteLog: [...werewolf.voteLog, { day, voter: actorId, target, reason }],
          }
          break
        }
        case 'werewolf/game-end': {
          const winnerRaw = event.payload.winner
          const winner =
            winnerRaw === 'werewolves' || winnerRaw === 'villagers' || winnerRaw === 'tie'
              ? winnerRaw
              : null
          const actualRoles =
            event.payload.actualRoles && typeof event.payload.actualRoles === 'object'
              ? (event.payload.actualRoles as Record<string, string>)
              : null
          werewolf = { ...werewolf, winner, roleAssignments: actualRoles }
          matchComplete = true
          status = 'settled'
          currentActor = null
          break
        }
      }

      return {
        events: [...state.events, event],
        phase,
        handNumber,
        currentActor,
        players,
        communityCards,
        pot,
        status,
        matchComplete,
        winnerAgentId,
        thinkingByAgent,
        chipHistory,
        errorCount,
        werewolf,
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
    set({ matchComplete: true, winnerAgentId, currentActor: null, status: 'settled' })
  },

  recordHandSnapshot(handNumber, chips) {
    set((state) => ({
      chipHistory: [...state.chipHistory, { handNumber, at: Date.now(), chips: { ...chips } }],
    }))
  },

  incrementError() {
    set((state) => ({ errorCount: state.errorCount + 1 }))
  },

  setErrorCount(count) {
    set({ errorCount: count })
  },
}))
