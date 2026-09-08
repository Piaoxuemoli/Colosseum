// 牌型评估器：best 5 of 7 枚举（调研 §2.2 选型：正确性优先）。
// 移植自旧引擎 src/games/poker/engine/evaluator.ts（含轮子 A-2-3-4-5 处理），
// 按 PFR-201 重新组织输出：category / tiebreak（比较键）/ value（编码值）/ best5。

import type { Card } from './cards'
import { rankValue } from './cards'

export const HAND_CATEGORIES = [
  'high-card',
  'one-pair',
  'two-pair',
  'three-of-a-kind',
  'straight',
  'flush',
  'full-house',
  'four-of-a-kind',
  'straight-flush',
] as const
export type HandCategory = (typeof HAND_CATEGORIES)[number]

export const CATEGORY_RANK: Record<HandCategory, number> = {
  'high-card': 1,
  'one-pair': 2,
  'two-pair': 3,
  'three-of-a-kind': 4,
  straight: 5,
  flush: 6,
  'full-house': 7,
  'four-of-a-kind': 8,
  'straight-flush': 9,
}

export const CATEGORY_NAME: Record<HandCategory, string> = {
  'high-card': 'High Card',
  'one-pair': 'One Pair',
  'two-pair': 'Two Pair',
  'three-of-a-kind': 'Three of a Kind',
  straight: 'Straight',
  flush: 'Flush',
  'full-house': 'Full House',
  'four-of-a-kind': 'Four of a Kind',
  'straight-flush': 'Straight Flush',
}

export interface HandEvaluation {
  /** 牌型类别（皇家同花顺是 straight-flush 的特例，见 name 字段）。 */
  category: HandCategory
  categoryRank: number
  /** 比较键：同级牌型逐位比较，全等才平局；花色永不参与。 */
  tiebreak: readonly number[]
  /** 编码值：category 主导 + tiebreak base-15，可直接用于比大小。 */
  value: number
  best5: readonly Card[]
  /** 展示名（同花顺 A 高时为 'Royal Flush'）。 */
  name: string
}

/** 摊牌比牌：>0 甲胜，<0 乙胜，0 平局。 */
export function compareEvaluations(a: HandEvaluation, b: HandEvaluation): number {
  if (a.categoryRank !== b.categoryRank) return a.categoryRank - b.categoryRank
  const len = Math.min(a.tiebreak.length, b.tiebreak.length)
  for (let i = 0; i < len; i++) {
    if (a.tiebreak[i] !== b.tiebreak[i]) return a.tiebreak[i] - b.tiebreak[i]
  }
  return 0
}

/** best N 选 5（N ≥ 5）：等价于"从全部 5 张组合中取最强"（PFR-201）。 */
export function evaluateBest(cards: readonly Card[]): HandEvaluation {
  if (cards.length < 5) {
    throw new Error(`evaluateBest: 至少需要 5 张牌，收到 ${cards.length}`)
  }
  const combos = combinations5(cards)
  let best: HandEvaluation | null = null
  for (const combo of combos) {
    const ev = evaluate5(combo)
    if (best === null || compareEvaluations(ev, best) > 0) {
      best = ev
    }
  }
  if (best === null) {
    throw new Error('evaluateBest: 未产生任何组合')
  }
  return best
}

/** 恰好 5 张牌的评估。 */
export function evaluate5(cards: readonly Card[]): HandEvaluation {
  if (cards.length !== 5) {
    throw new Error(`evaluate5: 恰好需要 5 张牌，收到 ${cards.length}`)
  }
  const values = cards.map((card) => rankValue(card.rank)).sort((a, b) => b - a)
  const suits = cards.map((card) => card.suit)
  const isFlush = suits.every((suit) => suit === suits[0])
  const straight = detectStraight(values)

  const counts = new Map<number, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const groups = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return b[0] - a[0]
  })

  if (isFlush && straight.isStraight) {
    const high = straight.highCard
    return build('straight-flush', [high], cards, high === 14 ? 'Royal Flush' : CATEGORY_NAME['straight-flush'])
  }
  if (groups[0][1] === 4) {
    return build('four-of-a-kind', [groups[0][0], groups[1][0]], cards)
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return build('full-house', [groups[0][0], groups[1][0]], cards)
  }
  if (isFlush) {
    return build('flush', values, cards)
  }
  if (straight.isStraight) {
    return build('straight', [straight.highCard], cards)
  }
  if (groups[0][1] === 3) {
    const kickers = groups.slice(1).map((g) => g[0]).sort((a, b) => b - a)
    return build('three-of-a-kind', [groups[0][0], ...kickers], cards)
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0])
    const lowPair = Math.min(groups[0][0], groups[1][0])
    return build('two-pair', [highPair, lowPair, groups[2][0]], cards)
  }
  if (groups[0][1] === 2) {
    const kickers = groups.slice(1).map((g) => g[0]).sort((a, b) => b - a)
    return build('one-pair', [groups[0][0], ...kickers], cards)
  }
  return build('high-card', values, cards)
}

function build(
  category: HandCategory,
  tiebreak: readonly number[],
  cards: readonly Card[],
  name?: string,
): HandEvaluation {
  return {
    category,
    categoryRank: CATEGORY_RANK[category],
    tiebreak,
    value: encodeValue(CATEGORY_RANK[category], tiebreak),
    best5: [...cards],
    name: name ?? CATEGORY_NAME[category],
  }
}

function encodeValue(categoryRank: number, tiebreak: readonly number[]): number {
  const padded = [...tiebreak, 0, 0, 0, 0, 0].slice(0, 5)
  return padded.reduce((score, value) => score * 15 + value, categoryRank)
}

/** 轮子 A-2-3-4-5 以 5 为高（PFR-201）。 */
function detectStraight(sortedDesc: readonly number[]): { isStraight: boolean; highCard: number } {
  const unique = [...new Set(sortedDesc)].sort((a, b) => b - a)
  if (unique.length < 5) return { isStraight: false, highCard: 0 }
  for (let i = 0; i + 4 < unique.length; i++) {
    if (unique[i] - unique[i + 4] === 4) {
      return { isStraight: true, highCard: unique[i] }
    }
  }
  const has = (v: number) => unique.includes(v)
  if (has(14) && has(5) && has(4) && has(3) && has(2)) {
    return { isStraight: true, highCard: 5 }
  }
  return { isStraight: false, highCard: 0 }
}

function combinations5(cards: readonly Card[]): Card[][] {
  const result: Card[][] = []
  const n = cards.length
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            result.push([cards[a], cards[b], cards[c], cards[d], cards[e]])
          }
        }
      }
    }
  }
  return result
}
