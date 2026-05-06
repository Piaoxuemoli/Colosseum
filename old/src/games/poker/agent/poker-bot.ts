import type { Player } from '../../../types/player'
import type { ActionType } from '../../../types/action'
import type { GameState } from '../../../types/game'
import { calculateEquity } from '../engine/equity'
import { getPositionByOffset, holeCardsToNotation, getHandTier, isInRange } from './preflop-ranges'

export interface BotDecision {
  type: ActionType
  amount: number
}

export class BotAI {
  /**
   * Get the fixed bet size for the current street (Fixed-Limit).
   */
  private getFixedBetSize(state: GameState): number {
    return (state.phase === 'turn' || state.phase === 'river')
      ? state.bigBlind   // 大注
      : state.smallBlind // 小注
  }

  /**
   * Main decision entry point.
   */
  decide(bot: Player, state: GameState): BotDecision {
    if (state.phase === 'preflop') {
      return this.preflopDecision(bot, state)
    }
    return this.postflopDecision(bot, state)
  }

  /**
   * Preflop: Use position-based range tables
   */
  private preflopDecision(bot: Player, state: GameState): BotDecision {
    const activePlayers = state.players.filter(p => p.status === 'active' || p.status === 'allIn')
    // Compute position using seatIndex offset from dealer
    const sortedActive = [...activePlayers].sort((a, b) => {
      const offsetA = (a.seatIndex - state.dealerIndex + 6) % 6
      const offsetB = (b.seatIndex - state.dealerIndex + 6) % 6
      return offsetA - offsetB
    })
    const botOffset = sortedActive.findIndex(p => p.id === bot.id)
    const position = getPositionByOffset(botOffset >= 0 ? botOffset : 0, sortedActive.length)
    const notation = holeCardsToNotation(bot.holeCards)
    const tier = getHandTier(notation)
    const inRange = isInRange(notation, position)

    const highestBet = Math.max(...state.players.map(p => p.currentBet))
    const toCall = highestBet - bot.currentBet
    const canCheck = toCall === 0

    // Random factor for variety
    const random = Math.random()

    // Suppress unused variable warnings
    void tier

    // Not in range — fold or occasionally bluff
    if (!inRange) {
      if (canCheck) return { type: 'check', amount: 0 }
      // 8% bluff raise, 5% call
      if (random < 0.08) {
        return this.makeRaise(bot, state)
      }
      if (random < 0.13 && toCall <= state.smallBlind * 2) {
        return { type: 'call', amount: Math.min(toCall, bot.chips) }
      }
      return { type: 'fold', amount: 0 }
    }

    // Tier 1-2: Strong hands — raise/re-raise
    if (getHandTier(notation) <= 2) {
      if (toCall === 0) {
        return this.makeBet(bot, state)
      }
      // Face a raise — re-raise with Tier 1, call with Tier 2
      if (getHandTier(notation) === 1 && random < 0.7) {
        return this.makeRaise(bot, state)
      }
      return { type: 'call', amount: Math.min(toCall, bot.chips) }
    }

    // Tier 3: Mix raise/call
    if (getHandTier(notation) === 3) {
      if (canCheck) {
        return random < 0.6
          ? this.makeBet(bot, state)
          : { type: 'check', amount: 0 }
      }
      if (toCall <= state.smallBlind * 3) {
        return random < 0.4
          ? this.makeRaise(bot, state)
          : { type: 'call', amount: Math.min(toCall, bot.chips) }
      }
      return random < 0.3
        ? { type: 'call', amount: Math.min(toCall, bot.chips) }
        : { type: 'fold', amount: 0 }
    }

    // Tier 4-5: Call cheap or fold
    if (canCheck) return { type: 'check', amount: 0 }
    if (toCall <= state.smallBlind * 2) {
      return { type: 'call', amount: Math.min(toCall, bot.chips) }
    }
    return random < 0.2
      ? { type: 'call', amount: Math.min(toCall, bot.chips) }
      : { type: 'fold', amount: 0 }
  }

  /**
   * Postflop: Equity-based decisions with pot odds (Fixed-Limit: fixed bet/raise)
   */
  private postflopDecision(bot: Player, state: GameState): BotDecision {
    const equity = calculateEquity(bot.holeCards, state.communityCards, 200)
    const highestBet = Math.max(...state.players.map(p => p.currentBet))
    const toCall = highestBet - bot.currentBet
    const canCheck = toCall === 0
    const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0

    const random = Math.random()
    // Add 15% random variance to make bot less predictable
    const adjustedEquity = equity + (random - 0.5) * 0.15

    // Strong hand — bet/raise
    if (adjustedEquity > 0.7) {
      if (canCheck) {
        return this.makeBet(bot, state)
      }
      // Raise if facing a bet
      return this.makeRaise(bot, state)
    }

    // Decent hand — call if pot odds are right
    if (adjustedEquity > potOdds && adjustedEquity > 0.35) {
      if (canCheck) {
        // Sometimes bet for value, sometimes check
        if (random < 0.4) {
          return this.makeBet(bot, state)
        }
        return { type: 'check', amount: 0 }
      }
      return { type: 'call', amount: Math.min(toCall, bot.chips) }
    }

    // Weak hand — check or fold
    if (canCheck) {
      // Semi-bluff ~20% of the time
      if (random < 0.20) {
        return this.makeBet(bot, state)
      }
      return { type: 'check', amount: 0 }
    }

    // Facing a bet with weak hand — occasionally call as bluff catcher
    if (random < 0.12 && toCall <= state.pot * 0.5) {
      return { type: 'call', amount: Math.min(toCall, bot.chips) }
    }

    return { type: 'fold', amount: 0 }
  }

  /**
   * Helper: Make a bet (Fixed-Limit: fixed amount)
   */
  private makeBet(bot: Player, state: GameState): BotDecision {
    const fixedBetSize = this.getFixedBetSize(state)
    const bet = Math.min(fixedBetSize, bot.chips)
    return { type: 'bet', amount: bet }
  }

  /**
   * Helper: Make a raise (Fixed-Limit: fixed amount).
   */
  private makeRaise(bot: Player, state: GameState): BotDecision {
    const highestBet = Math.max(...state.players.map(p => p.currentBet))
    const fixedBetSize = this.getFixedBetSize(state)
    const raiseTotal = highestBet + fixedBetSize
    const toInvest = raiseTotal - bot.currentBet
    if (toInvest >= bot.chips) {
      // Auto all-in: engine will handle via call clamping
      return { type: 'call', amount: bot.chips }
    }
    return { type: 'raise', amount: raiseTotal }
  }
}
