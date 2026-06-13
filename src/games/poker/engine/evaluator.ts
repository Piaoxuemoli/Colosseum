import type { Card } from './card'
import { rankValue } from './card'

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

export type HandRank = (typeof HandRank)[keyof typeof HandRank]

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
  values: number[]
  value: number
  bestCards: Card[]
  rankName: string
}

export function evaluateHand(cards: Card[]): HandEvaluation {
  if (cards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${cards.length}`)
  }

  const combinations = getCombinations(cards, 5)
  let best: HandEvaluation | null = null

  for (const combo of combinations) {
    const result = evaluate5(combo)
    if (!best || compareHands(result, best) > 0) {
      best = result
    }
  }

  return best!
}

export function compareHands(a: HandEvaluation, b: HandEvaluation): number {
  if (a.rank !== b.rank) return a.rank - b.rank

  for (let i = 0; i < Math.min(a.values.length, b.values.length); i++) {
    if (a.values[i] !== b.values[i]) return a.values[i] - b.values[i]
  }

  return 0
}

function evaluate5(cards: Card[]): HandEvaluation {
  const values = cards.map((card) => rankValue(card.rank)).sort((a, b) => b - a)
  const suits = cards.map((card) => card.suit)
  const isFlush = suits.every((suit) => suit === suits[0])
  const { isStraight, highCard } = checkStraight(values)
  const counts = new Map<number, number>()

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  const groups = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return b[0] - a[0]
  })

  if (isFlush && isStraight) {
    return buildEvaluation({
      rank: HandRank.StraightFlush,
      values: [highCard],
      bestCards: cards,
      rankName: highCard === 14 ? 'Royal Flush' : RANK_NAMES[HandRank.StraightFlush],
    })
  }

  if (groups[0][1] === 4) {
    return buildEvaluation({
      rank: HandRank.FourOfAKind,
      values: [groups[0][0], groups[1][0]],
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.FourOfAKind],
    })
  }

  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return buildEvaluation({
      rank: HandRank.FullHouse,
      values: [groups[0][0], groups[1][0]],
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.FullHouse],
    })
  }

  if (isFlush) {
    return buildEvaluation({
      rank: HandRank.Flush,
      values,
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.Flush],
    })
  }

  if (isStraight) {
    return buildEvaluation({
      rank: HandRank.Straight,
      values: [highCard],
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.Straight],
    })
  }

  if (groups[0][1] === 3) {
    const kickers = groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)
    return buildEvaluation({
      rank: HandRank.ThreeOfAKind,
      values: [groups[0][0], ...kickers],
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.ThreeOfAKind],
    })
  }

  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0])
    const lowPair = Math.min(groups[0][0], groups[1][0])
    return buildEvaluation({
      rank: HandRank.TwoPair,
      values: [highPair, lowPair, groups[2][0]],
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.TwoPair],
    })
  }

  if (groups[0][1] === 2) {
    const kickers = groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)
    return buildEvaluation({
      rank: HandRank.OnePair,
      values: [groups[0][0], ...kickers],
      bestCards: cards,
      rankName: RANK_NAMES[HandRank.OnePair],
    })
  }

  return buildEvaluation({
    rank: HandRank.HighCard,
    values,
    bestCards: cards,
    rankName: RANK_NAMES[HandRank.HighCard],
  })
}

function buildEvaluation(input: Omit<HandEvaluation, 'value'>): HandEvaluation {
  return {
    ...input,
    value: encodeValue(input.rank, input.values),
  }
}

function encodeValue(rank: HandRank, values: number[]): number {
  const padded = [...values, 0, 0, 0, 0, 0].slice(0, 5)
  return padded.reduce((score, value) => score * 15 + value, rank)
}

function checkStraight(sortedValues: number[]): { isStraight: boolean; highCard: number } {
  const unique = [...new Set(sortedValues)].sort((a, b) => b - a)
  if (unique.length < 5) return { isStraight: false, highCard: 0 }

  for (let i = 0; i <= unique.length - 5; i++) {
    const window = unique.slice(i, i + 5)
    if (window[0] - window[4] === 4) {
      return { isStraight: true, highCard: window[0] }
    }
  }

  if (unique.includes(14) && unique.includes(5) && unique.includes(4) && unique.includes(3) && unique.includes(2)) {
    return { isStraight: true, highCard: 5 }
  }

  return { isStraight: false, highCard: 0 }
}

function getCombinations<T>(items: T[], count: number): T[][] {
  const result: T[][] = []

  function backtrack(start: number, current: T[]) {
    if (current.length === count) {
      result.push([...current])
      return
    }

    for (let i = start; i < items.length; i++) {
      current.push(items[i])
      backtrack(i + 1, current)
      current.pop()
    }
  }

  backtrack(0, [])
  return result
}
