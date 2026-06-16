'use client'

import { create } from 'zustand'
import type { GameEvent } from '@/platform/core/types'

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

export type WerewolfDeathEntry = {
  agentId: string
  day: number
  cause: string | null
}

export type WerewolfDerived = {
  day: number
  phase: string | null
  speechLog: WerewolfSpeechEntry[]
  voteLog: WerewolfVoteEntry[]
  moderatorNarration: WerewolfNarrationEntry[]
  deaths: WerewolfDeathEntry[]
  roleAssignments: Record<string, string> | null
  winner: 'werewolves' | 'villagers' | 'tie' | null
}

export type RichGameEvent = GameEvent & { handNumberAt: number }

export type RightPanelTab = 'status' | 'rank' | 'actions' | 'thinking' | 'impressions' | 'chart'

export type MatchViewState = {
  matchId: string
  initialized: boolean
  events: RichGameEvent[]
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
  chipHistory: ChipSnapshot[]
  werewolf: WerewolfDerived
  rightPanelTab: RightPanelTab
  expandedActionHands: number[]
  expandedThinkingHands: number[]
  reset(): void
  init(input: { matchId: string; players: PokerUiPlayer[] }): void
  ingestEvent(event: GameEvent): void
  setMatchEnd(winnerAgentId: string | null): void
  recordHandSnapshot(handNumber: number, chips: Record<string, number>): void
  setRightPanelTab(tab: RightPanelTab): void
  toggleActionHand(handNumber: number): void
  toggleThinkingHand(handNumber: number): void
  ensureActionHandExpanded(handNumber: number): void
  ensureThinkingHandExpanded(handNumber: number): void
}

export type MatchViewProjection = Omit<
  MatchViewState,
  | 'reset'
  | 'init'
  | 'ingestEvent'
  | 'setMatchEnd'
  | 'recordHandSnapshot'
  | 'setRightPanelTab'
  | 'toggleActionHand'
  | 'toggleThinkingHand'
  | 'ensureActionHandExpanded'
  | 'ensureThinkingHandExpanded'
>

const initialWerewolf: WerewolfDerived = {
  day: 0,
  phase: null,
  speechLog: [],
  voteLog: [],
  moderatorNarration: [],
  deaths: [],
  roleAssignments: null,
  winner: null,
}

const initialState = {
  matchId: '',
  initialized: false,
  events: [] as RichGameEvent[],
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
  chipHistory: [] as ChipSnapshot[],
  werewolf: initialWerewolf,
  rightPanelTab: 'status' as RightPanelTab,
  expandedActionHands: [] as number[],
  expandedThinkingHands: [] as number[],
}

function createInitialProjection(input?: { matchId: string; players: PokerUiPlayer[] }): MatchViewProjection {
  return {
    ...initialState,
    matchId: input?.matchId ?? initialState.matchId,
    initialized: input ? true : initialState.initialized,
    players: input?.players ?? initialState.players,
    phase: input ? 'preflop' : initialState.phase,
    handNumber: input ? 1 : initialState.handNumber,
    status: input ? 'live' : initialState.status,
    events: [] as RichGameEvent[],
  }
}

function toggleNumber(list: number[], value: number): number[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

function appendNumberOnce(list: number[], value: number): number[] {
  return list.includes(value) ? list : [...list, value]
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

export function reduceMatchViewEvent(state: MatchViewProjection, event: GameEvent): MatchViewProjection {
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
  let werewolf = state.werewolf
  let players = state.players

  switch (event.kind) {
    case 'poker/match-start':
      handNumber = Math.max(handNumber, 1)
      phase = 'preflop'
      status = 'live'
      break
    case 'poker/hand-start':
      handNumber = numberOr(event.payload.handNumber, handNumber)
      phase = 'preflop'
      status = 'live'
      break
    case 'poker/state': {
      const prevHandNumber = handNumber
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
      if (handNumber > prevHandNumber && prevHandNumber > 0) {
        const last = chipHistory[chipHistory.length - 1]
        if (!last || last.handNumber !== prevHandNumber) {
          chipHistory = [
            ...chipHistory,
            {
              handNumber: prevHandNumber,
              at: Date.now(),
              chips: Object.fromEntries(players.map((player) => [player.agentId, player.chips])),
            },
          ]
        }
      }
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
      const existingIndex = chipHistory.findIndex((snapshot) => snapshot.handNumber === handNumber)
      const snapshot = {
        handNumber,
        at: Date.now(),
        chips: Object.fromEntries(players.map((player) => [player.agentId, player.chips])),
      }
      if (existingIndex >= 0) {
        chipHistory = [...chipHistory.slice(0, existingIndex), snapshot, ...chipHistory.slice(existingIndex + 1)]
      } else {
        chipHistory = [...chipHistory, snapshot]
      }
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
      const upcomingPhase = typeof event.payload.upcomingPhase === 'string' ? event.payload.upcomingPhase : werewolf.phase
      const narration = typeof event.payload.narration === 'string' ? event.payload.narration : ''
      // 公告出局名单（夜间刀/毒在白天公告、投票在切换夜间时公告）。
      const rawDeaths = Array.isArray(event.payload.deaths) ? event.payload.deaths : []
      const existingDead = new Set(werewolf.deaths.map((d) => d.agentId))
      const newDeaths: WerewolfDeathEntry[] = []
      for (const d of rawDeaths) {
        if (d && typeof d === 'object' && typeof (d as { agentId?: unknown }).agentId === 'string') {
          const agentId = (d as { agentId: string }).agentId
          if (!existingDead.has(agentId)) {
            existingDead.add(agentId)
            newDeaths.push({
              agentId,
              day,
              cause: typeof (d as { cause?: unknown }).cause === 'string' ? (d as { cause: string }).cause : null,
            })
          }
        }
      }
      werewolf = {
        ...werewolf,
        day,
        phase: upcomingPhase,
        moderatorNarration: [...werewolf.moderatorNarration, { day, phase: upcomingPhase ?? '', narration }],
        deaths: newDeaths.length > 0 ? [...werewolf.deaths, ...newDeaths] : werewolf.deaths,
      }
      break
    }
    case 'werewolf/speak': {
      const actorId = event.actorAgentId
      if (!actorId) break
      const day = typeof event.payload.day === 'number' ? event.payload.day : werewolf.day
      const content = typeof event.payload.content === 'string' ? event.payload.content : ''
      const claimedRole = typeof event.payload.claimedRole === 'string' ? event.payload.claimedRole : undefined
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
      const target = typeof event.payload.target === 'string' ? event.payload.target : null
      const reason = typeof event.payload.reason === 'string' ? event.payload.reason : undefined
      werewolf = {
        ...werewolf,
        voteLog: [...werewolf.voteLog, { day, voter: actorId, target, reason }],
      }
      break
    }
    case 'werewolf/game-end': {
      const winnerRaw = event.payload.winner
      const winner = winnerRaw === 'werewolves' || winnerRaw === 'villagers' || winnerRaw === 'tie' ? winnerRaw : null
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
    ...state,
    events: [...state.events, { ...event, handNumberAt: handNumber }],
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
    werewolf,
  }
}

export function deriveMatchView(events: GameEvent[], input: { matchId: string; players: PokerUiPlayer[] }): MatchViewProjection {
  return events.reduce(
    (state, event) => reduceMatchViewEvent(state, event),
    createInitialProjection(input),
  )
}

export const useMatchViewStore = create<MatchViewState>((set) => ({
  ...initialState,

  reset() {
    set({ ...initialState })
  },

  init(input) {
    set(createInitialProjection(input))
  },

  ingestEvent(event) {
    set((state) => reduceMatchViewEvent(state, event))
  },

  setMatchEnd(winnerAgentId) {
    set({ matchComplete: true, winnerAgentId, currentActor: null, status: 'settled' })
  },

  recordHandSnapshot(handNumber, chips) {
    set((state) => ({
      chipHistory: [...state.chipHistory, { handNumber, at: Date.now(), chips: { ...chips } }],
    }))
  },

  setRightPanelTab(tab) {
    set({ rightPanelTab: tab })
  },

  toggleActionHand(handNumber) {
    set((state) => ({ expandedActionHands: toggleNumber(state.expandedActionHands, handNumber) }))
  },

  toggleThinkingHand(handNumber) {
    set((state) => ({ expandedThinkingHands: toggleNumber(state.expandedThinkingHands, handNumber) }))
  },

  ensureActionHandExpanded(handNumber) {
    set((state) => ({ expandedActionHands: appendNumberOnce(state.expandedActionHands, handNumber) }))
  },

  ensureThinkingHandExpanded(handNumber) {
    set((state) => ({ expandedThinkingHands: appendNumberOnce(state.expandedThinkingHands, handNumber) }))
  },
}))
