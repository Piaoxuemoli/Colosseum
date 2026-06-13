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

export type PokerStreetPots = {
  preflop: number
  flop: number
  turn: number
  river: number
}

export type PokerSidePot = {
  amount: number
  eligiblePlayerIds: string[]
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
  streetPots: PokerStreetPots
  sidePots: PokerSidePot[]
  dealerIndex: number
  smallBlindIndex: number
  bigBlindIndex: number
  stopRequested: boolean
  status: 'waiting' | 'live' | 'settled'
  matchComplete: boolean
  winnerAgentId: string | null
  fallbackCount: number
  chipHistory: ChipSnapshot[]
  errorCount: number
  werewolf: WerewolfDerived
  reset(): void
  init(input: { matchId: string; players: PokerUiPlayer[] }): void
  ingestEvent(event: GameEvent): void
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
  streetPots: { preflop: 0, flop: 0, turn: 0, river: 0 } as PokerStreetPots,
  sidePots: [] as PokerSidePot[],
  dealerIndex: 0,
  smallBlindIndex: 1,
  bigBlindIndex: 2,
  stopRequested: false,
  status: 'waiting' as const,
  matchComplete: false,
  winnerAgentId: null as string | null,
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

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function parseStreetPots(value: unknown, fallback: PokerStreetPots): PokerStreetPots {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    preflop: numberOr(raw.preflop, fallback.preflop),
    flop: numberOr(raw.flop, fallback.flop),
    turn: numberOr(raw.turn, fallback.turn),
    river: numberOr(raw.river, fallback.river),
  }
}

function parseSidePots(value: unknown): PokerSidePot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const eligiblePlayerIds = Array.isArray(raw.eligiblePlayerIds)
      ? raw.eligiblePlayerIds.filter((id): id is string => typeof id === 'string')
      : []
    return [{ amount: numberOr(raw.amount, 0), eligiblePlayerIds }]
  })
}

function parseCards(value: unknown): CardVisual[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    if (typeof raw.rank !== 'string' || typeof raw.suit !== 'string') return []
    return [{ rank: raw.rank, suit: raw.suit }]
  })
}

function playerFromPublicState(raw: Record<string, unknown>, existing: PokerUiPlayer | undefined): PokerUiPlayer {
  const agentId = typeof raw.id === 'string' ? raw.id : (existing?.agentId ?? '')
  const statusRaw = raw.status
  const status =
    statusRaw === 'active' ||
    statusRaw === 'folded' ||
    statusRaw === 'allIn' ||
    statusRaw === 'eliminated' ||
    statusRaw === 'sittingOut'
      ? statusRaw
      : (existing?.status ?? 'active')
  return {
    agentId,
    displayName: existing?.displayName ?? agentId,
    avatarEmoji: existing?.avatarEmoji ?? '🃏',
    seatIndex: numberOr(raw.seatIndex, existing?.seatIndex ?? 0),
    chips: numberOr(raw.chips, existing?.chips ?? 0),
    currentBet: numberOr(raw.currentBet, existing?.currentBet ?? 0),
    status,
    holeCards: parseCards(raw.holeCards),
  }
}

function playersFromPublicState(
  payload: Record<string, unknown>,
  currentPlayers: PokerUiPlayer[],
): PokerUiPlayer[] {
  if (!Array.isArray(payload.players)) return currentPlayers
  const next = payload.players.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const agentId = typeof raw.id === 'string' ? raw.id : null
    if (!agentId) return []
    const existing = currentPlayers.find((player) => player.agentId === agentId)
    return [playerFromPublicState(raw, existing)]
  })
  // Keep reference equality if the serialized state is identical.
  if (next.length === currentPlayers.length) {
    let changed = false
    for (let i = 0; i < next.length; i++) {
      const a = next[i]
      const b = currentPlayers[i]
      if (
        a.agentId !== b.agentId ||
        a.displayName !== b.displayName ||
        a.avatarEmoji !== b.avatarEmoji ||
        a.seatIndex !== b.seatIndex ||
        a.chips !== b.chips ||
        a.currentBet !== b.currentBet ||
        a.status !== b.status ||
        a.holeCards.length !== b.holeCards.length ||
        a.holeCards.some((c, idx) => c.rank !== b.holeCards[idx]?.rank || c.suit !== b.holeCards[idx]?.suit)
      ) {
        changed = true
        break
      }
    }
    if (!changed) return currentPlayers
  }
  return next
}

function updatePlayersOnAction(
  players: PokerUiPlayer[],
  actorId: string,
  action: Record<string, unknown>,
): { nextPlayers: PokerUiPlayer[]; potDelta: number } {
  const index = players.findIndex((player) => player.agentId === actorId)
  if (index < 0) return { nextPlayers: players, potDelta: 0 }

  const player = players[index]
  const type = action.type
  const contribution = actionContribution(action, player)

  // Rebuild only when at least one field actually changes.
  if (type === 'fold' && player.status !== 'folded') {
    const next = players.slice()
    next[index] = { ...player, status: 'folded' }
    return { nextPlayers: next, potDelta: 0 }
  }

  if (type === 'allIn') {
    if (player.status === 'allIn' && player.chips === 0 && contribution === 0) {
      return { nextPlayers: players, potDelta: 0 }
    }
    const next = players.slice()
    next[index] = { ...player, status: 'allIn', chips: 0, currentBet: player.currentBet + contribution }
    return { nextPlayers: next, potDelta: contribution }
  }

  if (contribution > 0) {
    const nextChips = Math.max(0, player.chips - contribution)
    const nextCurrentBet = player.currentBet + contribution
    if (nextChips === player.chips && nextCurrentBet === player.currentBet) {
      return { nextPlayers: players, potDelta: 0 }
    }
    const next = players.slice()
    next[index] = { ...player, chips: nextChips, currentBet: nextCurrentBet }
    return { nextPlayers: next, potDelta: contribution }
  }

  return { nextPlayers: players, potDelta: 0 }
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
      let streetPots = state.streetPots
      let sidePots = state.sidePots
      let dealerIndex = state.dealerIndex
      let smallBlindIndex = state.smallBlindIndex
      let bigBlindIndex = state.bigBlindIndex
      let stopRequested = state.stopRequested
      let matchComplete = state.matchComplete
      let winnerAgentId = state.winnerAgentId
      let status = state.status
      let chipHistory = state.chipHistory
      let errorCount = state.errorCount
      let werewolf = state.werewolf
      let players = state.players

      switch (event.kind) {
        case 'agent_error':
          errorCount += 1
          break
        case 'poker/match-start':
          handNumber = Math.max(handNumber, 1)
          phase = 'preflop'
          status = 'live'
          break
        case 'poker/state': {
          phase = typeof event.payload.phase === 'string' ? event.payload.phase : phase
          handNumber = numberOr(event.payload.handNumber, handNumber)
          currentActor = stringOrNull(event.payload.currentActor)
          dealerIndex = numberOr(event.payload.dealerIndex, dealerIndex)
          smallBlindIndex = numberOr(event.payload.smallBlindIndex, smallBlindIndex)
          bigBlindIndex = numberOr(event.payload.bigBlindIndex, bigBlindIndex)
          communityCards = parseCards(event.payload.communityCards)
          pot = numberOr(event.payload.pot, pot)
          streetPots = parseStreetPots(event.payload.streetPots, streetPots)
          sidePots = parseSidePots(event.payload.sidePots)
          stopRequested = Boolean(event.payload.stopRequested)
          matchComplete = Boolean(event.payload.matchComplete)
          if (matchComplete) status = 'settled'
          players = playersFromPublicState(event.payload, players)
          break
        }
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
          const result = updatePlayersOnAction(players, event.actorAgentId ?? '', event.payload)
          players = result.nextPlayers
          pot += result.potDelta
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

          let playersChanged = false
          const awarded = players.map((player) => {
            if (winnerIds.includes(player.agentId)) {
              if (share !== 0) {
                playersChanged = true
                return { ...player, chips: player.chips + share }
              }
            }
            if (player.currentBet !== 0) {
              playersChanged = true
              return { ...player, currentBet: 0 }
            }
            return player
          })
          if (playersChanged) players = awarded

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
        streetPots,
        sidePots,
        dealerIndex,
        smallBlindIndex,
        bigBlindIndex,
        stopRequested,
        status,
        matchComplete,
        winnerAgentId,
        chipHistory,
        errorCount,
        werewolf,
      }
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
