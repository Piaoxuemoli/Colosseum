import type { Player, PlayerType, StructuredImpression } from '../../../types/player'
import type { ActionType, PlayerAction } from '../../../types/action'
import type { GameState, TimingConfig } from '../../../types/game'
import type { HandHistory, PlayerSnapshot, WinnerRecord } from '../../../types/history'
import { createDeck, shuffleDeck } from '../../../types/card'
import { dealCards } from './deck'
import { evaluateHand, compareHands } from './evaluator'
import type { HandEvaluation } from './evaluator'
import { calculateSidePots } from './pot-manager'
import type { PlayerBet } from './pot-manager'
import { BotAI } from '../agent/poker-bot'

export interface SeatSetup {
  type: PlayerType | 'empty'
  name: string
  chips: number
  profileId?: string
  systemPrompt?: string
}

export interface GameConfig {
  seats: SeatSetup[]
  smallBlind: number
  bigBlind: number
  sessionId: string
  timingConfig?: TimingConfig
}

export interface AvailableAction {
  type: ActionType
  minAmount?: number
  maxAmount?: number
}

/** Serialized form of GameEngine — all Maps converted to plain objects, deck omitted */
export interface SerializedEngine {
  state: GameState
  streetActions: {
    preflop: PlayerAction[]
    flop: PlayerAction[]
    turn: PlayerAction[]
    river: PlayerAction[]
  }
  currentHandThoughts: Record<string, string>
  initialPlayerChips: Record<string, number>
  totalChipsInGame: number
  handHistories: HandHistory[]
  /** Player impressions: playerId → { targetId → StructuredImpression } */
  playerImpressions: Record<string, Record<string, StructuredImpression>>
}

export class GameEngine {
  private state: GameState
  private botAI: BotAI
  private streetActions: {
    preflop: PlayerAction[]
    flop: PlayerAction[]
    turn: PlayerAction[]
    river: PlayerAction[]
  }
  private handHistories: HandHistory[] = []
  private initialPlayerChips: Map<string, number> = new Map()
  /** LLM thinking content collected during current hand */
  private currentHandThoughts: Record<string, string> = {}
  /** Total chips in game — set once in constructor, never changes */
  private totalChipsInGame: number

  constructor(config: GameConfig) {
    this.botAI = new BotAI()

    // Create players from seat config
    const players: Player[] = []
    for (let i = 0; i < config.seats.length; i++) {
      const seat = config.seats[i]
      if (seat.type === 'empty') continue

      players.push({
        id: `player-${i}`,
        name: seat.name,
        type: seat.type as PlayerType,
        chips: seat.chips,
        status: 'active',
        holeCards: [],
        currentBet: 0,
        totalBetThisRound: 0,
        seatIndex: i,
        hasActed: false,
        profileId: seat.profileId,
        systemPrompt: seat.systemPrompt,
        impressions: seat.type === 'llm' ? new Map() : undefined,
      })
    }

    // Shuffle player order, then assign consecutive seatIndices 0..N-1
    // This ensures D/SB/BB are visually adjacent on the poker table
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[players[i], players[j]] = [players[j], players[i]]
    }
    for (let i = 0; i < players.length; i++) {
      players[i].seatIndex = i
    }

    const timingConfig: TimingConfig = config.timingConfig || {
      minActionInterval: 1500,
      thinkingTimeout: 30000,
    }

    this.state = {
      id: crypto.randomUUID(),
      phase: 'waiting',
      communityCards: [],
      pot: 0,
      sidePots: [],
      players,
      dealerIndex: 0,
      currentPlayerIndex: 0,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
      minRaise: config.bigBlind,
      deck: [],
      actionHistory: [],
      handNumber: 0,
      sessionId: config.sessionId,
      timingConfig,
    }

    this.streetActions = {
      preflop: [],
      flop: [],
      turn: [],
      river: [],
    }

    // Record total chips for conservation assertion
    this.totalChipsInGame = players.reduce((sum, p) => sum + p.chips, 0)
  }

  /** Get the total chips expected in the game (for testing) */
  getTotalChipsInGame(): number {
    return this.totalChipsInGame
  }

  /** Serialize engine state for persistence (showdown only, deck omitted) */
  serialize(): SerializedEngine {
    // Collect player impressions (Map → plain object)
    const playerImpressions: Record<string, Record<string, StructuredImpression>> = {}
    for (const p of this.state.players) {
      if (p.impressions) {
        playerImpressions[p.id] = Object.fromEntries(p.impressions)
      }
    }

    // Deep-copy state, clear deck (showdown — not needed)
    const stateCopy: GameState = {
      ...this.state,
      deck: [],
      players: this.state.players.map(p => ({
        ...p,
        holeCards: [...p.holeCards],
        impressions: undefined, // stored separately in playerImpressions
      })),
      communityCards: [...this.state.communityCards],
      sidePots: this.state.sidePots.map(sp => ({
        ...sp,
        eligiblePlayerIds: [...sp.eligiblePlayerIds],
      })),
      actionHistory: [...this.state.actionHistory],
    }

    return {
      state: stateCopy,
      streetActions: {
        preflop: [...this.streetActions.preflop],
        flop: [...this.streetActions.flop],
        turn: [...this.streetActions.turn],
        river: [...this.streetActions.river],
      },
      currentHandThoughts: { ...this.currentHandThoughts },
      initialPlayerChips: Object.fromEntries(this.initialPlayerChips),
      totalChipsInGame: this.totalChipsInGame,
      handHistories: this.handHistories.map(h => ({ ...h })),
      playerImpressions,
    }
  }

  /** Restore engine from serialized data (bypass constructor) */
  static restore(data: SerializedEngine): GameEngine {
    const engine = Object.create(GameEngine.prototype) as GameEngine

    // Restore player impressions as Map
    const players = data.state.players.map(p => ({
      ...p,
      holeCards: [...p.holeCards],
      impressions: data.playerImpressions[p.id]
        ? new Map(Object.entries(data.playerImpressions[p.id]))
        : (p.type === 'llm' ? new Map<string, StructuredImpression>() : undefined),
    }))

    engine.state = {
      ...data.state,
      deck: [],
      players,
      communityCards: [...data.state.communityCards],
      sidePots: data.state.sidePots.map(sp => ({
        ...sp,
        eligiblePlayerIds: [...sp.eligiblePlayerIds],
      })),
      actionHistory: [...data.state.actionHistory],
    }

    engine.streetActions = {
      preflop: [...data.streetActions.preflop],
      flop: [...data.streetActions.flop],
      turn: [...data.streetActions.turn],
      river: [...data.streetActions.river],
    }

    engine.currentHandThoughts = { ...data.currentHandThoughts }
    engine.initialPlayerChips = new Map(Object.entries(data.initialPlayerChips).map(
      ([k, v]) => [k, v] as [string, number]
    ))
    engine.totalChipsInGame = data.totalChipsInGame
    engine.handHistories = data.handHistories.map(h => ({ ...h }))
    engine.botAI = new BotAI()

    return engine
  }

  getState(): GameState {
    return {
      ...this.state,
      players: this.state.players.map(p => ({
        ...p,
        holeCards: [...p.holeCards],
      })),
      communityCards: [...this.state.communityCards],
      sidePots: this.state.sidePots.map(sp => ({
        ...sp,
        eligiblePlayerIds: [...sp.eligiblePlayerIds],
      })),
      actionHistory: [...this.state.actionHistory],
      deck: [],  // Never expose the deck
    }
  }

  getHandHistories(): HandHistory[] {
    return [...this.handHistories]
  }

  getBotAI(): BotAI {
    return this.botAI
  }

  /** Record an LLM's thinking content for the current hand */
  recordThinking(playerId: string, thinking: string): void {
    this.currentHandThoughts[playerId] = thinking
  }

  /**
   * Start a new hand.
   */
  startNewHand(): void {
    this.state.handNumber++

    // Reset player states — always clear temporary fields first, then check status
    for (const player of this.state.players) {
      player.holeCards = []
      player.currentBet = 0
      player.totalBetThisRound = 0
      player.hasActed = false
      if (player.status === 'eliminated') continue
      player.status = player.chips > 0 ? 'active' : 'eliminated'
    }

    // Save initial chips for history
    this.initialPlayerChips.clear()
    for (const p of this.state.players) {
      this.initialPlayerChips.set(p.id, p.chips)
    }

    // Reset street actions + thoughts
    this.streetActions = { preflop: [], flop: [], turn: [], river: [] }
    this.currentHandThoughts = {}

    // Reset game state
    this.state.communityCards = []
    this.state.pot = 0
    this.state.sidePots = []
    this.state.actionHistory = []
    this.state.minRaise = this.state.smallBlind
    this.state.phase = 'preflop'

    // Move dealer (always, including first hand — randomize start)
    if (this.state.handNumber === 1) {
      // Random starting dealer for fairness — store seatIndex, not array index
      const activePlayers = this.state.players.filter(p => p.status === 'active')
      if (activePlayers.length > 0) {
        const randomIdx = Math.floor(Math.random() * activePlayers.length)
        this.state.dealerIndex = activePlayers[randomIdx].seatIndex
      }
    } else {
      this.state.dealerIndex = this.nextActiveSeatIndex(this.state.dealerIndex)
    }

    // Shuffle and deal
    this.state.deck = shuffleDeck(createDeck())
    this.dealHoleCards()

    // Post blinds
    this.postBlinds()

    // Chip conservation check after blinds
    this.assertChipConservation('postBlinds')

    // Set first to act
    const activePlayersForAct = this.state.players.filter(p => p.status === 'active')
    if (activePlayersForAct.length === 2) {
      // Heads-up: SB (dealer) acts first preflop
      this.state.currentPlayerIndex = this.state.dealerIndex
    } else {
      // Multi-way: UTG (after BB) acts first preflop
      const sb = this.nextActiveSeatIndex(this.state.dealerIndex)
      const bb = this.nextActiveSeatIndex(sb)
      this.state.currentPlayerIndex = this.nextActiveSeatIndex(bb)
    }
  }

  /**
   * Get the number of raises (bet/raise) in the current street.
   */
  private getCurrentStreetRaiseCount(): number {
    const phase = this.state.phase as 'preflop' | 'flop' | 'turn' | 'river'
    const actions = this.streetActions[phase] || []
    return actions.filter(a => a.type === 'bet' || a.type === 'raise').length
  }

  private static readonly RAISE_CAP = 4

  /**
   * Get the fixed bet size for the current street (Fixed-Limit).
   * Preflop/Flop = smallBlind (小注), Turn/River = bigBlind (大注)
   */
  private getFixedBetSize(): number {
    return (this.state.phase === 'turn' || this.state.phase === 'river')
      ? this.state.bigBlind   // 大注
      : this.state.smallBlind // 小注
  }

  /**
   * Get available actions for the current player (Fixed-Limit).
   */
  getAvailableActions(): AvailableAction[] {
    const player = this.getPlayerBySeatIndex(this.state.currentPlayerIndex)
    if (!player || player.status !== 'active') return []

    const highestBet = Math.max(...this.state.players.map(p => p.currentBet))
    const toCall = highestBet - player.currentBet
    const actions: AvailableAction[] = []

    const raiseCount = this.getCurrentStreetRaiseCount()
    // Heads-up (only 2 non-folded players) → no raise cap
    const nonFoldedCount = this.state.players.filter(
      p => p.status === 'active' || p.status === 'allIn'
    ).length
    const isHeadsUp = nonFoldedCount === 2
    const canRaise = isHeadsUp || raiseCount < GameEngine.RAISE_CAP

    const fixedBetSize = this.getFixedBetSize()

    if (toCall > 0) {
      actions.push({ type: 'fold' })
    }

    if (toCall === 0) {
      actions.push({ type: 'check' })
    }

    if (toCall > 0 && player.chips > 0) {
      actions.push({
        type: 'call',
        minAmount: Math.min(toCall, player.chips),
        maxAmount: Math.min(toCall, player.chips),
      })
    }

    // Bet (fixed amount) — only when no one has bet yet
    if (toCall === 0 && player.chips > 0 && canRaise) {
      const betAmount = Math.min(fixedBetSize, player.chips)
      actions.push({
        type: 'bet',
        minAmount: betAmount,
        maxAmount: betAmount,
      })
    }

    // Raise (fixed amount) — only when someone has bet
    if (toCall > 0 && player.chips > toCall && canRaise) {
      const raiseTotal = Math.min(highestBet + fixedBetSize, player.chips + player.currentBet)
      actions.push({
        type: 'raise',
        minAmount: raiseTotal,
        maxAmount: raiseTotal,
      })
    }

    return actions
  }

  /**
   * Execute a player action (synchronous core).
   */
  executeAction(action: { type: ActionType; amount?: number }): void {
    const player = this.getPlayerBySeatIndex(this.state.currentPlayerIndex)
    if (!player) return

    // Change 1: reject non-active players
    if (player.status !== 'active') return

    const highestBet = Math.max(...this.state.players.map(p => p.currentBet))

    // Enforce raise cap (with heads-up exception)
    const nonFoldedCount = this.state.players.filter(
      p => p.status === 'active' || p.status === 'allIn'
    ).length
    const isHeadsUp = nonFoldedCount === 2
    if ((action.type === 'bet' || action.type === 'raise') &&
        !isHeadsUp &&
        this.getCurrentStreetRaiseCount() >= GameEngine.RAISE_CAP) {
      const toCall = highestBet - player.currentBet
      if (toCall > 0) {
        action = { type: 'call', amount: Math.min(toCall, player.chips) }
      } else {
        action = { type: 'check', amount: 0 }
      }
    }

    // Change 1: validate action type against available actions
    const availableActions = this.getAvailableActions()
    const availableTypes = new Set(availableActions.map(a => a.type))
    if (!availableTypes.has(action.type)) {
      // Degrade to check (if available) or fold
      if (availableTypes.has('check')) {
        action = { type: 'check', amount: 0 }
      } else if (availableTypes.has('fold')) {
        action = { type: 'fold', amount: 0 }
      } else {
        return // No valid action possible
      }
    }

    // Change 1: clamp amount to valid range
    const matchingAction = availableActions.find(a => a.type === action.type)
    if (matchingAction && matchingAction.minAmount != null && matchingAction.maxAmount != null) {
      const amt = action.amount || 0
      action = {
        type: action.type,
        amount: Math.max(matchingAction.minAmount, Math.min(amt, matchingAction.maxAmount)),
      }
    }

    let amount = action.amount || 0

    switch (action.type) {
      case 'fold':
        player.status = 'folded'
        break

      case 'check':
        break

      case 'call': {
        const toCall = Math.min(highestBet - player.currentBet, player.chips)
        player.chips -= toCall
        player.currentBet += toCall
        player.totalBetThisRound += toCall
        this.state.pot += toCall
        amount = toCall
        if (player.chips === 0) player.status = 'allIn'
        break
      }

      case 'bet': {
        // Fixed-Limit: force fixed bet size
        const fixedBet = this.getFixedBetSize()
        const betAmount = Math.min(fixedBet, player.chips)
        player.chips -= betAmount
        player.currentBet += betAmount
        player.totalBetThisRound += betAmount
        this.state.pot += betAmount
        amount = betAmount
        if (player.chips === 0) player.status = 'allIn'
        break
      }

      case 'raise': {
        // Fixed-Limit: force fixed raise size
        const fixedRaise = this.getFixedBetSize()
        const raiseTotal = Math.min(highestBet + fixedRaise, player.chips + player.currentBet)
        const raiseAmount = raiseTotal - player.currentBet
        const actualAmount = Math.min(raiseAmount, player.chips)
        player.chips -= actualAmount
        player.currentBet += actualAmount
        player.totalBetThisRound += actualAmount
        this.state.pot += actualAmount
        // Record the total raise level for display: "加注到 $X"
        amount = player.currentBet
        if (player.chips === 0) player.status = 'allIn'
        break
      }

      case 'allIn': {
        const allInAmount = player.chips
        player.currentBet += allInAmount
        player.totalBetThisRound += allInAmount
        this.state.pot += allInAmount
        player.chips = 0
        player.status = 'allIn'
        // Record total amount (consistent with raise)
        amount = player.currentBet
        break
      }
    }

    // Record action
    const playerAction: PlayerAction = {
      playerId: player.id,
      type: action.type,
      amount,
      timestamp: Date.now(),
      phase: this.state.phase,
    }
    this.state.actionHistory.push(playerAction)
    this.recordStreetAction(playerAction)

    // After bet/raise: reset hasActed for other active players so they get a chance to respond
    if (action.type === 'bet' || action.type === 'raise' || action.type === 'allIn') {
      for (const p of this.state.players) {
        if (p.id !== player.id && p.status === 'active') {
          p.hasActed = false
        }
      }
    }

    player.hasActed = true

    // Chip conservation check
    this.assertChipConservation('executeAction')

    // Check if hand is over (only one non-folded player left)
    const activePlayers = this.state.players.filter(
      p => p.status === 'active' || p.status === 'allIn'
    )
    if (activePlayers.length <= 1) {
      this.handleLastPlayerWins()
      return
    }

    // Check if betting round is over
    if (this.isBettingRoundOver()) {
      this.advancePhase()
    } else {
      const nextSeat = this.nextActiveSeatIndex(this.state.currentPlayerIndex)
      if (nextSeat === this.state.currentPlayerIndex) {
        // No other active player found — round should end
        this.advancePhase()
      } else {
        this.state.currentPlayerIndex = nextSeat
      }
    }
  }

  /**
   * Peek the next player that should act (bot or llm).
   * Returns null if the current player is human or the hand is over.
   */
  peekNextNonHumanPlayer(): Player | null {
    if (this.state.phase === 'showdown' || this.state.phase === 'waiting') return null

    const p = this.getPlayerBySeatIndex(this.state.currentPlayerIndex)
    if (!p || p.status !== 'active') return null
    return p.type !== 'human' ? p : null
  }

  /**
   * Legacy: peek next bot player (for backward compat with old hook)
   */
  peekNextBotPlayer(): Player | null {
    return this.peekNextNonHumanPlayer()
  }

  /**
   * Execute a single bot action (the current player must be a bot).
   */
  executeSingleBotAction(): { playerId: string; action: { type: ActionType; amount?: number } } | null {
    if (this.state.phase === 'showdown' || this.state.phase === 'waiting') return null

    let maxSkips = this.state.players.length
    while (maxSkips-- > 0) {
      const currentPlayer = this.getPlayerBySeatIndex(this.state.currentPlayerIndex)
      if (!currentPlayer) return null
      if (currentPlayer.type === 'human') return null
      if (currentPlayer.type === 'llm') return null // LLM handled by adapter
      if (currentPlayer.status === 'active') {
        const decision = this.botAI.decide(currentPlayer, this.state)
        this.executeAction(decision)
        return { playerId: currentPlayer.id, action: decision }
      }
      this.state.currentPlayerIndex = this.nextActiveSeatIndex(this.state.currentPlayerIndex)
    }
    return null
  }

  // ---- Private Methods ----

  private dealHoleCards(): void {
    const activePlayers = this.state.players.filter(p => p.status !== 'sittingOut' && p.status !== 'eliminated')
    for (const player of activePlayers) {
      const { dealt, remaining } = dealCards(this.state.deck, 2)
      player.holeCards = dealt
      this.state.deck = remaining
    }
  }

  private postBlinds(): void {
    const activePlayers = this.state.players.filter(p => p.status === 'active')
    const isHeadsUp = activePlayers.length === 2

    let sbSeatIndex: number
    let bbSeatIndex: number

    if (isHeadsUp) {
      // Heads-up: dealer posts SB, other posts BB
      sbSeatIndex = this.state.dealerIndex
      bbSeatIndex = this.nextActiveSeatIndex(this.state.dealerIndex)
    } else {
      sbSeatIndex = this.nextActiveSeatIndex(this.state.dealerIndex)
      bbSeatIndex = this.nextActiveSeatIndex(sbSeatIndex)
    }

    const sbPlayer = this.getPlayerBySeatIndex(sbSeatIndex)!
    const bbPlayer = this.getPlayerBySeatIndex(bbSeatIndex)!

    // Post small blind (= 小注 / 2)
    const sbAmount = Math.min(Math.floor(this.state.smallBlind / 2), sbPlayer.chips)
    sbPlayer.chips -= sbAmount
    sbPlayer.currentBet = sbAmount
    sbPlayer.totalBetThisRound = sbAmount
    this.state.pot += sbAmount
    if (sbPlayer.chips === 0) sbPlayer.status = 'allIn'

    this.state.actionHistory.push({
      playerId: sbPlayer.id,
      type: 'postSmallBlind',
      amount: sbAmount,
      timestamp: Date.now(),
      phase: 'preflop',
    })
    this.streetActions.preflop.push({
      playerId: sbPlayer.id,
      type: 'postSmallBlind',
      amount: sbAmount,
      timestamp: Date.now(),
      phase: 'preflop',
    })

    // Post big blind (= 小注)
    const bbAmount = Math.min(this.state.smallBlind, bbPlayer.chips)
    bbPlayer.chips -= bbAmount
    bbPlayer.currentBet = bbAmount
    bbPlayer.totalBetThisRound = bbAmount
    this.state.pot += bbAmount
    if (bbPlayer.chips === 0) bbPlayer.status = 'allIn'

    this.state.actionHistory.push({
      playerId: bbPlayer.id,
      type: 'postBigBlind',
      amount: bbAmount,
      timestamp: Date.now(),
      phase: 'preflop',
    })
    this.streetActions.preflop.push({
      playerId: bbPlayer.id,
      type: 'postBigBlind',
      amount: bbAmount,
      timestamp: Date.now(),
      phase: 'preflop',
    })
  }

  private advancePhase(): void {
    for (const player of this.state.players) {
      if (player.status === 'active') {
        player.currentBet = 0
        player.hasActed = false
      }
    }

    const activePlayers = this.state.players.filter(
      p => p.status === 'active' || p.status === 'allIn'
    )

    const canAct = activePlayers.filter(p => p.status === 'active')

    switch (this.state.phase) {
      case 'preflop':
        this.state.phase = 'flop'
        this.dealCommunityCards(3)
        break
      case 'flop':
        this.state.phase = 'turn'
        this.dealCommunityCards(1)
        break
      case 'turn':
        this.state.phase = 'river'
        this.dealCommunityCards(1)
        break
      case 'river':
        this.showdown()
        return
    }

    // Set minRaise to the fixed bet size for the new phase
    this.state.minRaise = this.getFixedBetSize()

    if (canAct.length < 2) {
      this.runOutBoard()
      return
    }

    this.state.currentPlayerIndex = this.nextActiveSeatIndex(this.state.dealerIndex)
  }

  private dealCommunityCards(count: number): void {
    // Burn a card
    this.state.deck = this.state.deck.slice(1)
    const { dealt, remaining } = dealCards(this.state.deck, count)
    this.state.communityCards.push(...dealt)
    this.state.deck = remaining
  }

  private runOutBoard(): void {
    while (this.state.communityCards.length < 5) {
      const phaseName = this.state.communityCards.length < 3 ? 'flop' :
        this.state.communityCards.length < 4 ? 'turn' : 'river'

      if (phaseName === 'flop' && this.state.phase !== 'flop') {
        this.state.phase = 'flop'
        this.dealCommunityCards(3)
      } else if (phaseName === 'turn' && this.state.communityCards.length < 4) {
        this.state.phase = 'turn'
        this.dealCommunityCards(1)
      } else if (phaseName === 'river' && this.state.communityCards.length < 5) {
        this.state.phase = 'river'
        this.dealCommunityCards(1)
      } else {
        break
      }
    }
    this.showdown()
  }

  private showdown(): void {
    this.state.phase = 'showdown'

    const contenders = this.state.players.filter(
      p => p.status === 'active' || p.status === 'allIn'
    )

    const bets: PlayerBet[] = this.state.players
      .filter(p => p.totalBetThisRound > 0)
      .map(p => ({
        playerId: p.id,
        amount: p.totalBetThisRound,
        isAllIn: p.status === 'allIn',
        isFolded: p.status === 'folded',
      }))

    const sidePots = calculateSidePots(bets)
    if (sidePots.length > 0) {
      this.state.sidePots = sidePots
    } else {
      this.state.sidePots = [{
        amount: this.state.pot,
        eligiblePlayerIds: contenders.map(p => p.id),
      }]
    }

    const evaluations = new Map<string, HandEvaluation>()
    for (const player of contenders) {
      if (player.holeCards.length === 2) {
        const allCards = [...player.holeCards, ...this.state.communityCards]
        if (allCards.length >= 5) {
          evaluations.set(player.id, evaluateHand(allCards))
        }
      }
    }

    const winners: WinnerRecord[] = []
    let lastWinnerId: string | null = null

    for (const pot of this.state.sidePots) {
      const eligibleContenders = pot.eligiblePlayerIds
        .filter(id => evaluations.has(id))

      // Change 6: orphan pot — no eligible contenders
      if (eligibleContenders.length === 0) {
        // Give to last winner, or if no winner yet, return to largest contributor
        if (lastWinnerId) {
          const player = this.state.players.find(p => p.id === lastWinnerId)!
          player.chips += pot.amount
          winners.push({
            playerId: lastWinnerId,
            amount: pot.amount,
            handRank: 'Unclaimed Pot',
            winningCards: [],
          })
        } else {
          // Return to largest contributor in this pot
          const maxContributor = this.state.players
            .filter(p => pot.eligiblePlayerIds.includes(p.id) || p.totalBetThisRound > 0)
            .sort((a, b) => b.totalBetThisRound - a.totalBetThisRound)[0]
          if (maxContributor) {
            maxContributor.chips += pot.amount
            winners.push({
              playerId: maxContributor.id,
              amount: pot.amount,
              handRank: 'Returned Pot',
              winningCards: [],
            })
          }
        }
        continue
      }

      let bestHand: HandEvaluation | null = null
      let potWinners: string[] = []

      for (const playerId of eligibleContenders) {
        const hand = evaluations.get(playerId)!
        if (!bestHand || compareHands(hand, bestHand) > 0) {
          bestHand = hand
          potWinners = [playerId]
        } else if (compareHands(hand, bestHand) === 0) {
          potWinners.push(playerId)
        }
      }

      const share = Math.floor(pot.amount / potWinners.length)
      const remainder = pot.amount - share * potWinners.length

      for (let i = 0; i < potWinners.length; i++) {
        const winnerId = potWinners[i]
        const player = this.state.players.find(p => p.id === winnerId)!
        const winAmount = share + (i === 0 ? remainder : 0)
        player.chips += winAmount
        lastWinnerId = winnerId

        const hand = evaluations.get(winnerId)!
        winners.push({
          playerId: winnerId,
          amount: winAmount,
          handRank: hand.rankName,
          winningCards: hand.bestCards,
        })
      }
    }

    this.saveHandHistory(winners)
    this.state.pot = 0
    this.assertChipConservation('showdown')
  }

  private handleLastPlayerWins(): void {
    this.state.phase = 'showdown'

    const winner = this.state.players.find(
      p => p.status === 'active' || p.status === 'allIn'
    )

    if (winner) {
      winner.chips += this.state.pot

      const winners: WinnerRecord[] = [{
        playerId: winner.id,
        amount: this.state.pot,
        handRank: 'Last Player Standing',
        winningCards: [],
      }]

      this.state.sidePots = [{
        amount: this.state.pot,
        eligiblePlayerIds: [winner.id],
      }]

      this.saveHandHistory(winners)
      this.state.pot = 0
      this.assertChipConservation('handleLastPlayerWins')
    }
  }

  private saveHandHistory(winners: WinnerRecord[]): void {
    const playerSnapshots: PlayerSnapshot[] = this.state.players.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type,
      seatIndex: p.seatIndex,
      chips: this.initialPlayerChips.get(p.id) || p.chips,
      chipsAfter: p.chips,
      holeCards: [...p.holeCards],
      finalStatus: p.status,
    }))

    // Collect current LLM impressions
    const llmImpressions: Record<string, Record<string, StructuredImpression>> = {}
    for (const p of this.state.players) {
      if (p.type === 'llm' && p.impressions) {
        llmImpressions[p.id] = Object.fromEntries(p.impressions)
      }
    }

    const history: HandHistory = {
      id: crypto.randomUUID(),
      handNumber: this.state.handNumber,
      timestamp: Date.now(),
      smallBlind: this.state.smallBlind,
      bigBlind: this.state.bigBlind,
      players: playerSnapshots,
      communityCards: [...this.state.communityCards],
      streets: {
        preflop: { actions: [...this.streetActions.preflop] },
        flop: { actions: [...this.streetActions.flop], cards: this.state.communityCards.slice(0, 3) },
        turn: { actions: [...this.streetActions.turn], cards: this.state.communityCards.slice(3, 4) },
        river: { actions: [...this.streetActions.river], cards: this.state.communityCards.slice(4, 5) },
      },
      winners,
      pot: this.state.pot,
      sidePots: [...this.state.sidePots],
      sessionId: this.state.sessionId,
      llmThoughts: { ...this.currentHandThoughts },
      llmImpressions,
    }

    this.handHistories.push(history)
  }

  private recordStreetAction(action: PlayerAction): void {
    const phase = this.state.phase as 'preflop' | 'flop' | 'turn' | 'river'
    if (this.streetActions[phase]) {
      this.streetActions[phase].push(action)
    }
  }

  private isBettingRoundOver(): boolean {
    const activePlayers = this.state.players.filter(p => p.status === 'active')

    if (activePlayers.length <= 1) return true

    const highestBet = Math.max(...this.state.players.map(p => p.currentBet))
    return activePlayers.every(p => p.hasActed && p.currentBet === highestBet)
  }

  /**
   * Find the next active player by seatIndex order (clockwise 0→1→2→3→4→5→0).
   * @param currentSeatIndex - a seatIndex (0-5), NOT an array index
   * @returns the seatIndex of the next active player
   */
  private nextActiveSeatIndex(currentSeatIndex: number): number {
    const totalSeats = 6
    for (let i = 1; i <= totalSeats; i++) {
      const nextSeat = (currentSeatIndex + i) % totalSeats
      const player = this.state.players.find(p => p.seatIndex === nextSeat && p.status === 'active')
      if (player) return nextSeat
    }
    return currentSeatIndex // fallback
  }

  /** Find a player by their seatIndex */
  private getPlayerBySeatIndex(seatIndex: number): Player | undefined {
    return this.state.players.find(p => p.seatIndex === seatIndex)
  }

  /**
   * Assert that total chips in the game are conserved.
   * Logs an error if violated but does not throw (to avoid breaking the game).
   */
  private assertChipConservation(context: string): void {
    const playerChips = this.state.players.reduce((sum, p) => sum + p.chips, 0)
    const pot = this.state.pot
    const total = playerChips + pot
    if (total !== this.totalChipsInGame) {
      console.error(
        `[CHIP CONSERVATION VIOLATION] at ${context}: ` +
        `expected ${this.totalChipsInGame}, got ${total} ` +
        `(players=${playerChips}, pot=${pot}). ` +
        `Players: ${this.state.players.map(p => `${p.name}:${p.chips}(bet=${p.currentBet})`).join(', ')}`
      )
    }
  }
}
