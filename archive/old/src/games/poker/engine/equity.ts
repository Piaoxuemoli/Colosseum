import type { Card } from '../../../types/card'
import { createDeck, shuffleDeck } from '../../../types/card'
import { evaluateHand, compareHands } from './evaluator'

/**
 * Monte Carlo equity calculator (single opponent).
 * Simulates random runouts against a random opponent to estimate hand equity.
 *
 * @param holeCards - Player's 2 hole cards
 * @param communityCards - 0-5 community cards already dealt
 * @param simulations - Number of Monte Carlo simulations (default 500)
 * @returns Equity as a number between 0 and 1
 */
export function calculateEquity(
  holeCards: Card[],
  communityCards: Card[],
  simulations: number = 500
): number {
  if (holeCards.length !== 2) {
    throw new Error(`Need exactly 2 hole cards, got ${holeCards.length}`)
  }

  // Cards already in use
  const usedCards = new Set(
    [...holeCards, ...communityCards].map(c => `${c.rank}${c.suit}`)
  )

  // Available cards for simulation
  const availableCards = createDeck().filter(
    c => !usedCards.has(`${c.rank}${c.suit}`)
  )

  const communityNeeded = 5 - communityCards.length
  let wins = 0
  let ties = 0

  for (let i = 0; i < simulations; i++) {
    const shuffled = shuffleDeck(availableCards)
    let idx = 0

    // Deal remaining community cards
    const simCommunity = [...communityCards]
    for (let j = 0; j < communityNeeded; j++) {
      simCommunity.push(shuffled[idx++])
    }

    // Deal opponent hole cards
    const opponentHole = [shuffled[idx++], shuffled[idx++]]

    // Evaluate both hands
    const heroHand = evaluateHand([...holeCards, ...simCommunity])
    const opponentHand = evaluateHand([...opponentHole, ...simCommunity])

    const cmp = compareHands(heroHand, opponentHand)
    if (cmp > 0) {
      wins++
    } else if (cmp === 0) {
      ties++
    }
  }

  return (wins + ties * 0.5) / simulations
}

/**
 * Result for a single player in multi-way equity calculation
 */
export interface PlayerEquity {
  playerId: string
  equity: number    // 0-1 win probability
  handName?: string // Best hand description (only available when all community cards dealt)
}

/**
 * Multi-player Monte Carlo equity calculator for spectator view.
 * Calculates win probability for each player simultaneously.
 *
 * @param players - Array of { playerId, holeCards } for each active player
 * @param communityCards - 0-5 community cards already dealt
 * @param simulations - Number of Monte Carlo simulations (default 2000)
 * @returns Array of equity results per player
 */
export function calculateMultiPlayerEquity(
  players: { playerId: string; holeCards: Card[] }[],
  communityCards: Card[],
  simulations: number = 2000,
): PlayerEquity[] {
  if (players.length < 2) {
    return players.map(p => ({ playerId: p.playerId, equity: 1 }))
  }

  // All known cards
  const usedCards = new Set<string>()
  for (const p of players) {
    for (const c of p.holeCards) usedCards.add(`${c.rank}${c.suit}`)
  }
  for (const c of communityCards) usedCards.add(`${c.rank}${c.suit}`)

  const availableCards = createDeck().filter(
    c => !usedCards.has(`${c.rank}${c.suit}`)
  )

  const communityNeeded = 5 - communityCards.length
  const winCount = new Map<string, number>()
  const tieCount = new Map<string, number>()
  for (const p of players) {
    winCount.set(p.playerId, 0)
    tieCount.set(p.playerId, 0)
  }

  for (let i = 0; i < simulations; i++) {
    const shuffled = shuffleDeck(availableCards)
    let idx = 0

    // Complete community cards
    const simCommunity = [...communityCards]
    for (let j = 0; j < communityNeeded; j++) {
      simCommunity.push(shuffled[idx++])
    }

    // Evaluate all hands
    const hands = players.map(p => ({
      playerId: p.playerId,
      eval: evaluateHand([...p.holeCards, ...simCommunity]),
    }))

    // Find best hand(s)
    let bestEval = hands[0].eval
    let winners = [hands[0].playerId]

    for (let h = 1; h < hands.length; h++) {
      const cmp = compareHands(hands[h].eval, bestEval)
      if (cmp > 0) {
        bestEval = hands[h].eval
        winners = [hands[h].playerId]
      } else if (cmp === 0) {
        winners.push(hands[h].playerId)
      }
    }

    if (winners.length === 1) {
      winCount.set(winners[0], (winCount.get(winners[0]) || 0) + 1)
    } else {
      // Tie — split credit
      for (const w of winners) {
        tieCount.set(w, (tieCount.get(w) || 0) + 1)
      }
    }
  }

  // Calculate equity
  const results: PlayerEquity[] = players.map(p => {
    const wins = winCount.get(p.playerId) || 0
    const ties = tieCount.get(p.playerId) || 0
    // For ties, each player gets 1/numTiedPlayers credit per tied hand
    // Approximate: use 0.5 * ties / numPlayers (simplified)
    const equity = (wins + ties * 0.5) / simulations

    // If all community cards are dealt, evaluate current hand name
    let handName: string | undefined
    if (communityCards.length === 5 && p.holeCards.length === 2) {
      const eval_ = evaluateHand([...p.holeCards, ...communityCards])
      handName = eval_.rankName
    }

    return { playerId: p.playerId, equity, handName }
  })

  return results
}

/**
 * Calculate the number of outs (cards that improve the hand significantly).
 * Simplified version: checks each remaining card to see if it improves the hand rank.
 */
export function calculateOuts(
  holeCards: Card[],
  communityCards: Card[]
): number {
  if (communityCards.length < 3 || communityCards.length >= 5) {
    return 0 // Only meaningful on flop or turn
  }

  const usedCards = new Set(
    [...holeCards, ...communityCards].map(c => `${c.rank}${c.suit}`)
  )

  const availableCards = createDeck().filter(
    c => !usedCards.has(`${c.rank}${c.suit}`)
  )

  const currentHand = evaluateHand([...holeCards, ...communityCards])
  let outs = 0

  for (const card of availableCards) {
    const newHand = evaluateHand([...holeCards, ...communityCards, card])
    if (newHand.rank > currentHand.rank) {
      outs++
    }
  }

  return outs
}
