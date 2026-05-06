import type { Card } from './card'
import { createDeck, shuffleDeck } from './card'
import { compareHands, evaluateHand } from './evaluator'

export type ComputeEquityInput = {
  holes: Card[][]
  community: Card[]
  iterations?: number
  rng?: () => number
}

export function computeEquity(input: ComputeEquityInput): number[] {
  const { holes, community, iterations = 1_000, rng = Math.random } = input
  if (holes.length === 0) return []
  for (const hand of holes) {
    if (hand.length !== 2) {
      throw new Error(`Need exactly 2 hole cards per player, got ${hand.length}`)
    }
  }
  if (community.length > 5) {
    throw new Error(`Need at most 5 community cards, got ${community.length}`)
  }

  const usedCards = new Set([...holes.flat(), ...community].map(cardKey))
  const baseDeck = createDeck().filter((card) => !usedCards.has(cardKey(card)))
  const wins = Array.from({ length: holes.length }, () => 0)
  const communityNeeded = 5 - community.length

  for (let i = 0; i < iterations; i++) {
    const shuffled = shuffleDeck(baseDeck, rng)
    const simulatedCommunity = [...community, ...shuffled.slice(0, communityNeeded)]
    const evaluations = holes.map((hole) => evaluateHand([...hole, ...simulatedCommunity]))
    let best = evaluations[0]
    let winnerIndexes = [0]

    for (let playerIndex = 1; playerIndex < evaluations.length; playerIndex++) {
      const comparison = compareHands(evaluations[playerIndex], best)
      if (comparison > 0) {
        best = evaluations[playerIndex]
        winnerIndexes = [playerIndex]
      } else if (comparison === 0) {
        winnerIndexes.push(playerIndex)
      }
    }

    const share = 1 / winnerIndexes.length
    for (const winnerIndex of winnerIndexes) {
      wins[winnerIndex] += share
    }
  }

  return wins.map((winCount) => winCount / iterations)
}

export function calculateEquity(
  holeCards: Card[],
  communityCards: Card[],
  simulations = 500,
  rng: () => number = Math.random,
): number {
  const usedCards = new Set([...holeCards, ...communityCards].map(cardKey))
  const deck = createDeck().filter((card) => !usedCards.has(cardKey(card)))
  let total = 0

  for (let i = 0; i < simulations; i++) {
    const shuffled = shuffleDeck(deck, rng)
    const opponentHole = shuffled.slice(0, 2)
    const result = computeEquity({
      holes: [holeCards, opponentHole],
      community: communityCards,
      iterations: 1,
      rng,
    })
    total += result[0]
  }

  return total / simulations
}

export interface PlayerEquity {
  playerId: string
  equity: number
  handName?: string
}

export function calculateMultiPlayerEquity(
  players: Array<{ playerId: string; holeCards: Card[] }>,
  communityCards: Card[],
  simulations = 2_000,
  rng: () => number = Math.random,
): PlayerEquity[] {
  if (players.length < 2) {
    return players.map((player) => ({ playerId: player.playerId, equity: 1 }))
  }

  const equities = computeEquity({
    holes: players.map((player) => player.holeCards),
    community: communityCards,
    iterations: simulations,
    rng,
  })

  return players.map((player, index) => ({
    playerId: player.playerId,
    equity: equities[index],
    handName:
      communityCards.length === 5 && player.holeCards.length === 2
        ? evaluateHand([...player.holeCards, ...communityCards]).rankName
        : undefined,
  }))
}

export function calculateOuts(holeCards: Card[], communityCards: Card[]): number {
  if (communityCards.length < 3 || communityCards.length >= 5) return 0

  const usedCards = new Set([...holeCards, ...communityCards].map(cardKey))
  const availableCards = createDeck().filter((card) => !usedCards.has(cardKey(card)))
  const currentHand = evaluateHand([...holeCards, ...communityCards])
  let outs = 0

  for (const card of availableCards) {
    const newHand = evaluateHand([...holeCards, ...communityCards, card])
    if (newHand.rank > currentHand.rank) outs++
  }

  return outs
}

function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`
}
