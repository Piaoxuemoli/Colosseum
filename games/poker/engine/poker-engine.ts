import { newEventId } from '@/lib/core/ids'
import type { GameEvent, MatchResult } from '@/lib/core/types'
import type { ActionSpec, ApplyActionResult, BoundaryKind, GameEngine } from '@/lib/engine/contracts'
import { createDeck, shuffleDeck } from './card'
import { dealCards } from './deck'
import { evaluateHand } from './evaluator'
import { calculateSidePots } from './pot-manager'
import type { PokerAction, PokerConfig, PokerPlayerState, PokerPublicState, PokerState } from './poker-types'

type BettingStreet = keyof PokerState['streetPots']

export class PokerEngine implements GameEngine<PokerState, PokerAction, PokerConfig> {
  createInitialState(config: PokerConfig, agentIds: string[]): PokerState {
    if (agentIds.length < 2) throw new Error('poker: at least 2 players required')

    const players: PokerPlayerState[] = agentIds.map((id, seatIndex) => ({
      id,
      seatIndex,
      chips: config.startingChips,
      holeCards: [],
      status: 'active',
      currentBet: 0,
      totalCommitted: 0,
      hasActedThisStreet: false,
    }))

    const dealerIndex = Math.floor(Math.random() * players.length)
    let remaining = shuffleDeck(createDeck())

    for (const player of players) {
      const result = dealCards(remaining, 2)
      player.holeCards = result.dealt
      remaining = result.remaining
    }

    const smallBlindIndex = this.smallBlindIndexFor(players, dealerIndex)
    const bigBlindIndex = this.bigBlindIndexFor(players, dealerIndex)
    this.postBlind(players[smallBlindIndex], config.smallBlind)
    this.postBlind(players[bigBlindIndex], config.bigBlind)

    const underTheGunIndex =
      players.length === 2 ? dealerIndex : this.nextActiveIndex(players, bigBlindIndex)

    const state: PokerState = {
      phase: 'preflop',
      handNumber: 1,
      dealerIndex,
      smallBlindIndex,
      bigBlindIndex,
      players,
      communityCards: [],
      currentActor: players[underTheGunIndex].id,
      actionHistory: [],
      betsThisStreet: 1,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
      startingChips: config.startingChips,
      pot: config.smallBlind + config.bigBlind,
      streetPots: this.emptyStreetPots(config.smallBlind + config.bigBlind),
      sidePots: [],
      stopRequested: false,
      handComplete: false,
      matchComplete: false,
      deck: remaining,
    }
    state.sidePots = this.calculateCurrentSidePots(state)
    return state
  }

  currentActor(state: PokerState): string | null {
    return state.currentActor
  }

  createPublicState(state: PokerState): PokerPublicState {
    return {
      phase: state.phase,
      handNumber: state.handNumber,
      dealerIndex: state.dealerIndex,
      smallBlindIndex: state.smallBlindIndex,
      bigBlindIndex: state.bigBlindIndex,
      currentActor: state.currentActor,
      communityCards: [...state.communityCards],
      players: state.players.map((player) => ({
        id: player.id,
        seatIndex: player.seatIndex,
        chips: player.chips,
        holeCards: [...player.holeCards],
        status: player.status,
        currentBet: player.currentBet,
      })),
      pot: state.pot,
      streetPots: { ...state.streetPots },
      sidePots: state.sidePots.map((pot) => ({
        amount: pot.amount,
        eligiblePlayerIds: [...pot.eligiblePlayerIds],
      })),
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      startingChips: state.startingChips,
      stopRequested: state.stopRequested,
      handComplete: state.handComplete,
      matchComplete: state.matchComplete,
    }
  }

  makePublicStateEvent(state: PokerState, kind = 'poker/state'): GameEvent {
    return this.makeEvent({
      kind,
      actorAgentId: null,
      payload: this.createPublicState(state) as unknown as Record<string, unknown>,
    })
  }

  continueAfterHand(state: PokerState): ApplyActionResult<PokerState> {
    const next = this.cloneState(state)

    if (next.stopRequested) {
      next.currentActor = null
      next.matchComplete = true
      return {
        nextState: next,
        events: [
          this.makeEvent({
            kind: 'poker/match-end',
            actorAgentId: null,
            payload: { winnerId: this.chipLeaderId(next) },
          }),
          this.makePublicStateEvent(next),
        ],
      }
    }

    // Endless table: always start the next hand unless the user requested stop.
    this.startNextHand(next)
    return {
      nextState: next,
      events: [
        this.makeEvent({
          kind: 'poker/hand-start',
          actorAgentId: null,
          payload: { handNumber: next.handNumber },
        }),
        this.makePublicStateEvent(next),
      ],
    }
  }

  requestStopAfterHand(state: PokerState): PokerState {
    const next = this.cloneState(state)
    next.stopRequested = true
    return next
  }

  availableActions(state: PokerState, agentId: string): ActionSpec<PokerAction>[] {
    const player = state.players.find((candidate) => candidate.id === agentId)
    if (!player || player.status !== 'active') return []

    const maxBet = Math.max(...state.players.map((candidate) => candidate.currentBet))
    const toCall = maxBet - player.currentBet
    const actions: ActionSpec<PokerAction>[] = []

    if (toCall > 0) {
      const callAmount = Math.min(toCall, player.chips)
      actions.push({ type: 'fold' })
      actions.push({ type: 'call', label: `call ${callAmount}`, minAmount: callAmount, maxAmount: callAmount })
    } else {
      actions.push({ type: 'check' })
    }

    const streetBetSize = this.isSmallBetStreet(state.phase) ? state.smallBlind : state.bigBlind
    const canRaise = state.betsThisStreet < 4 && player.chips > toCall
    if (canRaise) {
      const raiseTo = maxBet + streetBetSize
      if (maxBet === 0) {
        actions.push({
          type: 'bet',
          label: `bet ${streetBetSize}`,
          minAmount: streetBetSize,
          maxAmount: streetBetSize,
        })
      } else if (player.chips >= toCall + streetBetSize) {
        actions.push({
          type: 'raise',
          label: `raise to ${raiseTo}`,
          minAmount: raiseTo,
          maxAmount: raiseTo,
        })
      } else {
        actions.push({
          type: 'allIn',
          label: `all-in ${player.chips}`,
          minAmount: player.chips,
          maxAmount: player.chips,
        })
      }
    }

    return actions
  }

  applyAction(state: PokerState, agentId: string, action: PokerAction): ApplyActionResult<PokerState> {
    const next = this.cloneState(state)
    const player = next.players.find((candidate) => candidate.id === agentId)
    if (!player) return this.rejectAction(next, agentId, action, 'unknown actor')

    const maxBet = Math.max(...next.players.map((candidate) => candidate.currentBet))
    const toCall = maxBet - player.currentBet
    const events: GameEvent[] = []

    switch (action.type) {
      case 'fold':
        player.status = 'folded'
        player.hasActedThisStreet = true
        events.push(this.recordAction(next, agentId, action))
        break
      case 'check':
        if (toCall > 0) return this.rejectAction(next, agentId, action, 'cannot check facing bet')
        player.hasActedThisStreet = true
        events.push(this.recordAction(next, agentId, action))
        break
      case 'call': {
        const paid = Math.min(toCall, player.chips)
        player.chips -= paid
        player.currentBet += paid
        player.totalCommitted += paid
        this.addToPot(next, paid)
        if (player.chips === 0) player.status = 'allIn'
        player.hasActedThisStreet = true
        events.push(this.recordAction(next, agentId, { type: 'call', amount: paid }))
        break
      }
      case 'bet':
      case 'raise': {
        const targetBet = action.type === 'bet' ? action.amount : action.toAmount
        const paid = targetBet - player.currentBet
        if (targetBet <= maxBet || paid > player.chips) {
          return this.rejectAction(next, agentId, action, 'invalid bet size')
        }
        player.chips -= paid
        player.currentBet = targetBet
        player.totalCommitted += paid
        this.addToPot(next, paid)
        if (player.chips === 0) player.status = 'allIn'
        player.hasActedThisStreet = true
        next.betsThisStreet += 1
        this.resetOtherActivePlayers(next, agentId)
        events.push(this.recordAction(next, agentId, action))
        break
      }
      case 'allIn': {
        const paid = player.chips
        player.currentBet += paid
        player.totalCommitted += paid
        player.chips = 0
        player.status = 'allIn'
        this.addToPot(next, paid)
        player.hasActedThisStreet = true
        if (player.currentBet > maxBet) {
          next.betsThisStreet += 1
          this.resetOtherActivePlayers(next, agentId)
        }
        events.push(this.recordAction(next, agentId, { type: 'allIn', amount: paid }))
        break
      }
      case 'postSmallBlind':
      case 'postBigBlind':
        return this.rejectAction(next, agentId, action, 'blind actions are engine-controlled')
    }

    const notFolded = next.players.filter(
      (candidate) =>
        candidate.status !== 'folded' && candidate.status !== 'eliminated' && candidate.status !== 'sittingOut',
    )
    if (notFolded.length <= 1) {
      next.currentActor = null
      next.handComplete = true
      events.push(...this.settleHand(next))
      return { nextState: next, events }
    }

    if (this.isStreetComplete(next)) {
      events.push(...this.advanceStreet(next))
    } else {
      next.currentActor = this.findNextActor(next)
    }

    return { nextState: next, events }
  }

  boundary(prevState: PokerState, nextState: PokerState): BoundaryKind | null {
    if (!prevState.handComplete && nextState.handComplete) return 'hand-end'
    if (!prevState.matchComplete && nextState.matchComplete) return 'match-end'
    return null
  }

  finalize(state: PokerState): MatchResult {
    const sorted = [...state.players].sort((a, b) => b.chips - a.chips)
    return {
      winnerFaction: null,
      ranking: sorted.map((player, index) => ({
        agentId: player.id,
        rank: index + 1,
        score: player.chips,
      })),
    }
  }

  private postBlind(player: PokerPlayerState, amount: number): void {
    const paid = Math.min(player.chips, amount)
    player.chips -= paid
    player.currentBet = paid
    player.totalCommitted = paid
    if (paid < amount || player.chips === 0) player.status = 'allIn'
  }

  private cloneState(state: PokerState): PokerState {
    return {
      ...state,
      streetPots: { ...state.streetPots },
      sidePots: state.sidePots.map((pot) => ({
        amount: pot.amount,
        eligiblePlayerIds: [...pot.eligiblePlayerIds],
      })),
      players: state.players.map((player) => ({
        ...player,
        holeCards: [...player.holeCards],
      })),
      communityCards: [...state.communityCards],
      actionHistory: state.actionHistory.map((record) => ({ ...record })),
      deck: [...state.deck],
    }
  }

  private recordAction(state: PokerState, agentId: string, action: PokerAction): GameEvent {
    state.actionHistory.push({
      seq: state.actionHistory.length + 1,
      phase: state.phase === 'waiting' || state.phase === 'handComplete' ? 'preflop' : state.phase,
      agentId,
      action,
    })
    return this.makeEvent({
      kind: 'poker/action',
      actorAgentId: agentId,
      payload: action,
    })
  }

  private rejectAction(
    state: PokerState,
    agentId: string,
    action: PokerAction,
    reason: string,
  ): ApplyActionResult<PokerState> {
    return {
      nextState: state,
      events: [
        this.makeEvent({
          kind: 'poker/rejection',
          actorAgentId: agentId,
          payload: { reason, action },
        }),
      ],
    }
  }

  private isSmallBetStreet(phase: PokerState['phase']): boolean {
    return phase === 'preflop' || phase === 'flop'
  }

  private emptyStreetPots(preflop = 0): PokerState['streetPots'] {
    return { preflop, flop: 0, turn: 0, river: 0 }
  }

  private currentBettingStreet(state: PokerState): BettingStreet | null {
    return state.phase === 'preflop' || state.phase === 'flop' || state.phase === 'turn' || state.phase === 'river'
      ? state.phase
      : null
  }

  private addToPot(state: PokerState, amount: number): void {
    if (amount <= 0) return
    state.pot += amount
    const street = this.currentBettingStreet(state)
    if (street) state.streetPots[street] += amount
    state.sidePots = this.calculateCurrentSidePots(state)
  }

  private findNextActor(state: PokerState): string | null {
    if (state.currentActor === null) return null
    const startIndex = state.players.findIndex((player) => player.id === state.currentActor)
    if (startIndex === -1) return null
    const maxBet = Math.max(...state.players.map((player) => player.currentBet))

    for (let offset = 1; offset <= state.players.length; offset++) {
      const player = state.players[(startIndex + offset) % state.players.length]
      if (player.status !== 'active') continue
      if (!player.hasActedThisStreet || player.currentBet < maxBet) return player.id
    }

    return null
  }

  private isStreetComplete(state: PokerState): boolean {
    const active = state.players.filter((player) => player.status === 'active')
    if (active.length === 0) return true

    const activeOrAllIn = state.players.filter((player) => player.status === 'active' || player.status === 'allIn')
    const maxBet = Math.max(...activeOrAllIn.map((player) => player.currentBet))

    return active.every((player) => player.currentBet === maxBet && player.hasActedThisStreet)
  }

  private advanceStreet(state: PokerState): GameEvent[] {
    const events: GameEvent[] = []

    for (const player of state.players) {
      player.currentBet = 0
      player.hasActedThisStreet = false
    }
    state.betsThisStreet = 0

    if (state.phase === 'preflop') {
      const result = dealCards(state.deck, 3)
      state.communityCards.push(...result.dealt)
      state.deck = result.remaining
      state.phase = 'flop'
      events.push(this.makeEvent({ kind: 'poker/deal-flop', actorAgentId: null, payload: { cards: result.dealt } }))
    } else if (state.phase === 'flop') {
      const result = dealCards(state.deck, 1)
      state.communityCards.push(...result.dealt)
      state.deck = result.remaining
      state.phase = 'turn'
      events.push(this.makeEvent({ kind: 'poker/deal-turn', actorAgentId: null, payload: { cards: result.dealt } }))
    } else if (state.phase === 'turn') {
      const result = dealCards(state.deck, 1)
      state.communityCards.push(...result.dealt)
      state.deck = result.remaining
      state.phase = 'river'
      events.push(this.makeEvent({ kind: 'poker/deal-river', actorAgentId: null, payload: { cards: result.dealt } }))
    } else if (state.phase === 'river') {
      state.phase = 'showdown'
      state.currentActor = null
      state.handComplete = true
      events.push(this.makeEvent({ kind: 'poker/showdown', actorAgentId: null, payload: {} }))
      events.push(...this.settleHand(state))
      return events
    }

    state.currentActor = this.firstPostflopActor(state)
    return events
  }

  private firstPostflopActor(state: PokerState): string | null {
    const firstIndex = (state.dealerIndex + 1) % state.players.length
    for (let offset = 0; offset < state.players.length; offset++) {
      const player = state.players[(firstIndex + offset) % state.players.length]
      if (player.status === 'active') return player.id
    }
    return null
  }

  private resetOtherActivePlayers(state: PokerState, actorId: string): void {
    for (const player of state.players) {
      if (player.id !== actorId && player.status === 'active') player.hasActedThisStreet = false
    }
  }

  private settleHand(state: PokerState): GameEvent[] {
    const events: GameEvent[] = []
    const pots = this.calculateCurrentSidePots(state)
    state.sidePots = pots

    for (const pot of pots) {
      const eligible = state.players.filter((player) => pot.eligiblePlayerIds.includes(player.id))
      const winners =
        eligible.length === 1
          ? eligible
          : this.showdownWinners(eligible, state.communityCards)
      const baseShare = Math.floor(pot.amount / winners.length)
      let remainder = pot.amount - baseShare * winners.length

      for (const winner of winners) {
        winner.chips += baseShare + (remainder > 0 ? 1 : 0)
        if (remainder > 0) remainder -= 1
      }

      events.push(
        this.makeEvent({
          kind: 'poker/pot-award',
          actorAgentId: null,
          payload: { potAmount: pot.amount, winnerIds: winners.map((winner) => winner.id) },
        }),
      )
    }

    // Endless table: players with zero chips are not eliminated; they will be
    // reloaded in startNextHand. The match only ends when the user explicitly
    // requests stop after the current hand.
    return events
  }

  private calculateCurrentSidePots(state: PokerState): PokerState['sidePots'] {
    return calculateSidePots(
      state.players.map((player) => ({
        playerId: player.id,
        amount: player.totalCommitted,
        isAllIn: player.status === 'allIn',
        isFolded: player.status === 'folded',
      })),
    )
  }

  private startNextHand(state: PokerState): void {
    state.handNumber += 1
    state.phase = 'preflop'
    state.handComplete = false
    state.matchComplete = false
    state.communityCards = []
    state.actionHistory = []
    state.betsThisStreet = 1
    state.pot = 0
    state.streetPots = this.emptyStreetPots()
    state.sidePots = []
    state.deck = shuffleDeck(createDeck())

    // Endless table: reload any player who cannot afford the big blind.
    for (const player of state.players) {
      player.currentBet = 0
      player.totalCommitted = 0
      player.hasActedThisStreet = false
      player.holeCards = []
      if (player.chips < state.bigBlind && player.status !== 'sittingOut') {
        player.chips = state.startingChips
      }
      player.status = player.chips > 0 ? 'active' : 'eliminated'
    }

    state.dealerIndex = this.nextActiveIndex(state.players, state.dealerIndex)
    state.smallBlindIndex = this.smallBlindIndexFor(state.players, state.dealerIndex)
    state.bigBlindIndex = this.bigBlindIndexFor(state.players, state.dealerIndex)

    let remaining = state.deck
    for (const player of state.players) {
      if (player.status === 'eliminated') continue
      const result = dealCards(remaining, 2)
      player.holeCards = result.dealt
      remaining = result.remaining
    }
    state.deck = remaining

    this.postBlind(state.players[state.smallBlindIndex], state.smallBlind)
    this.postBlind(state.players[state.bigBlindIndex], state.bigBlind)
    this.addToPot(state, state.players[state.smallBlindIndex].currentBet + state.players[state.bigBlindIndex].currentBet)

    const firstActorIndex =
      state.players.filter((player) => player.status !== 'eliminated').length === 2
        ? state.dealerIndex
        : this.nextActiveIndex(state.players, state.bigBlindIndex)
    state.currentActor = state.players[firstActorIndex]?.id ?? null
  }

  private chipLeaderId(state: PokerState): string | null {
    return [...state.players].sort((a, b) => b.chips - a.chips)[0]?.id ?? null
  }

  private smallBlindIndexFor(players: PokerPlayerState[], dealerIndex: number): number {
    return players.filter((player) => player.status !== 'eliminated').length === 2
      ? dealerIndex
      : this.nextActiveIndex(players, dealerIndex)
  }

  private bigBlindIndexFor(players: PokerPlayerState[], dealerIndex: number): number {
    return this.nextActiveIndex(players, this.smallBlindIndexFor(players, dealerIndex))
  }

  private nextActiveIndex(players: PokerPlayerState[], fromIndex: number): number {
    for (let offset = 1; offset <= players.length; offset++) {
      const index = (fromIndex + offset) % players.length
      if (players[index].status !== 'eliminated' && players[index].status !== 'sittingOut' && players[index].chips > 0) {
        return index
      }
    }
    return fromIndex
  }

  private showdownWinners(players: PokerPlayerState[], communityCards: PokerState['communityCards']): PokerPlayerState[] {
    const hands = players.map((player) => ({
      player,
      hand: evaluateHand([...player.holeCards, ...communityCards]),
    }))
    const bestValue = Math.max(...hands.map((entry) => entry.hand.value))
    return hands.filter((entry) => entry.hand.value === bestValue).map((entry) => entry.player)
  }

  protected makeEvent(input: {
    matchId?: string
    kind: string
    actorAgentId: string | null
    payload: Record<string, unknown>
    visibility?: GameEvent['visibility']
    restrictedTo?: string[] | null
  }): GameEvent {
    return {
      id: newEventId(),
      matchId: input.matchId ?? '',
      gameType: 'poker',
      seq: 0,
      occurredAt: new Date().toISOString(),
      kind: input.kind,
      actorAgentId: input.actorAgentId,
      payload: input.payload,
      visibility: input.visibility ?? 'public',
      restrictedTo: input.restrictedTo ?? null,
    }
  }
}
