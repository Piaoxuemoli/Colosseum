import type { Card } from '../../../types/card'
import { rankValue } from '../../../types/card'

/**
 * Hand rankings from lowest to highest
 */
export const HandRank = {
  HighCard: 1,
  OnePair: 2,
  TwoPair: 3,
  ThreeOfAKind: 4,
  Straight: 5,
  Flush: 6,
  FullHouse: 7,
  FourOfAKind: 8,
  StraightFlush: 9,
} as const

export type HandRank = typeof HandRank[keyof typeof HandRank]

const RANK_NAMES: Record<HandRank, string> = {
  [HandRank.HighCard]: 'High Card',
  [HandRank.OnePair]: 'One Pair',
  [HandRank.TwoPair]: 'Two Pair',
  [HandRank.ThreeOfAKind]: 'Three of a Kind',
  [HandRank.Straight]: 'Straight',
  [HandRank.Flush]: 'Flush',
  [HandRank.FullHouse]: 'Full House',
  [HandRank.FourOfAKind]: 'Four of a Kind',
  [HandRank.StraightFlush]: 'Straight Flush',
}

export interface HandEvaluation {
  rank: HandRank
  values: number[] // Tiebreaker values, highest first
  bestCards: Card[]
  rankName: string
}

/**
 * Evaluate the best 5-card hand from 5-7 cards
 */
export function evaluateHand(cards: Card[]): HandEvaluation {
  if (cards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${cards.length}`)
  }

  if (cards.length === 5) {
    return evaluate5(cards)
  }

  // Enumerate all C(n,5) combinations and pick the best
  const combos = getCombinations(cards, 5)
  let best: HandEvaluation | null = null

  for (const combo of combos) {
    const result = evaluate5(combo)
    if (!best || compareHands(result, best) > 0) {
      best = result
    }
  }

  return best!
}

/**
 * Compare two hand evaluations.
 * Returns positive if a > b, negative if a < b, 0 if tie.
 */
export function compareHands(a: HandEvaluation, b: HandEvaluation): number {
  if (a.rank !== b.rank) {
    return a.rank - b.rank
  }
  // Compare tiebreaker values
  for (let i = 0; i < Math.min(a.values.length, b.values.length); i++) {
    if (a.values[i] !== b.values[i]) {
      return a.values[i] - b.values[i]
    }
  }
  return 0
}

/**
 * Evaluate exactly 5 cards
 */
function evaluate5(cards: Card[]): HandEvaluation {
  const values = cards.map(c => rankValue(c.rank)).sort((a, b) => b - a)
  const suits = cards.map(c => c.suit)

  // Check flush
  const isFlush = suits.every(s => s === suits[0])

  // Check straight
  const { isStraight, highCard } = checkStraight(values)

  // Count rank occurrences
  const counts = new Map<number, number>()
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1)
  }

  const groups = Array.from(counts.entries())
    .sort((a, b) => {
      // Sort by count desc, then by value desc
      if (b[1] !== a[1]) return b[1] - a[1]
      return b[0] - a[0]
    })

  // Determine hand rank
  if (isFlush && isStraight) {
    return {
      rank: HandRank.StraightFlush,
      values: [highCard],
      bestCards: cards,
      rankName: highCard === 14 ? 'Royal Flush' : RANK_NAMES[HandRank.StraightFlush],
    }
  }

  if (groups[0][1] === 4) {
    const quadVal = groups[0][0]
    const kicker = groups[1][0]
    return {
      rank: HandRank.FourOfAKind,
      values: [quadVal, kicker],
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.FourOfAKind],
    }
  }

  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return {
      rank: HandRank.FullHouse,
      values: [groups[0][0], groups[1][0]],
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.FullHouse],
    }
  }

  if (isFlush) {
    return {
      rank: HandRank.Flush,
      values: values,
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.Flush],
    }
  }

  if (isStraight) {
    return {
      rank: HandRank.Straight,
      values: [highCard],
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.Straight],
    }
  }

  if (groups[0][1] === 3) {
    const tripVal = groups[0][0]
    const kickers = groups.slice(1).map(g => g[0]).sort((a, b) => b - a)
    return {
      rank: HandRank.ThreeOfAKind,
      values: [tripVal, ...kickers],
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.ThreeOfAKind],
    }
  }

  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0])
    const lowPair = Math.min(groups[0][0], groups[1][0])
    const kicker = groups[2][0]
    return {
      rank: HandRank.TwoPair,
      values: [highPair, lowPair, kicker],
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.TwoPair],
    }
  }

  if (groups[0][1] === 2) {
    const pairVal = groups[0][0]
    const kickers = groups.slice(1).map(g => g[0]).sort((a, b) => b - a)
    return {
      rank: HandRank.OnePair,
      values: [pairVal, ...kickers],
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.OnePair],
    }
  }

  // High card
  return {
    rank: HandRank.HighCard,
    values: values,
    bestCards: cards,
    rankName: RANK_NAMES[HandRank.HighCard],
  }
}

/**
 * Check if sorted values form a straight, including Ace-low (A-2-3-4-5)
 */
function checkStraight(sortedValues: number[]): { isStraight: boolean; highCard: number } {
  const unique = [...new Set(sortedValues)].sort((a, b) => b - a)

  if (unique.length < 5) {
    return { isStraight: false, highCard: 0 }
  }

  // Check normal straight (highest 5 consecutive)
  if (unique[0] - unique[4] === 4 && unique.length === 5) {
    return { isStraight: true, highCard: unique[0] }
  }

  // Check Ace-low straight: A(14)-5-4-3-2
  if (unique.includes(14) && unique.includes(2) && unique.includes(3) && unique.includes(4) && unique.includes(5)) {
    return { isStraight: true, highCard: 5 }
  }

  return { isStraight: false, highCard: 0 }
}

/**
 * Generate all C(n,k) combinations
 */
function getCombinations<T>(arr: T[], k: number): T[][] {
  const result: T[][] = []

  function backtrack(start: number, current: T[]) {
    if (current.length === k) {
      result.push([...current])
      return
    }
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i])
      backtrack(i + 1, current)
      current.pop()
    }
  }

  backtrack(0, [])
  return result
}
