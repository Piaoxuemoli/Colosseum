/**
 * 斗地主牌型检测器 — 基础版本 (单张/对子/三带/顺子/炸弹/火箭)
 */

import type { DdzCard, CardCombo } from './ddz-types'
import { ddzRankValue } from './ddz-types'

/** 检测出牌的牌型 */
export function detectCombo(cards: DdzCard[]): CardCombo | null {
  if (cards.length === 0) return null

  const sorted = [...cards].sort((a, b) => ddzRankValue(a.rank) - ddzRankValue(b.rank))

  // 火箭 (双王)
  if (cards.length === 2 &&
      cards.some(c => c.rank === 'JOKER_S') &&
      cards.some(c => c.rank === 'JOKER_B')) {
    return { type: 'rocket', cards: sorted, mainRank: 15 }
  }

  // 单张
  if (cards.length === 1) {
    return { type: 'single', cards: sorted, mainRank: ddzRankValue(cards[0].rank) }
  }

  // 统计每种面值的数量
  const countMap = new Map<number, number>()
  for (const c of cards) {
    const v = ddzRankValue(c.rank)
    countMap.set(v, (countMap.get(v) || 0) + 1)
  }

  const entries = Array.from(countMap.entries()).sort((a, b) => a[0] - b[0])
  const counts = entries.map(e => e[1])
  const ranks = entries.map(e => e[0])

  // 对子
  if (cards.length === 2 && counts.length === 1 && counts[0] === 2) {
    return { type: 'pair', cards: sorted, mainRank: ranks[0] }
  }

  // 炸弹 (四张同面值)
  if (cards.length === 4 && counts.length === 1 && counts[0] === 4) {
    return { type: 'bomb', cards: sorted, mainRank: ranks[0] }
  }

  // 三不带
  if (cards.length === 3 && counts.length === 1 && counts[0] === 3) {
    return { type: 'triple', cards: sorted, mainRank: ranks[0] }
  }

  // 三带一
  if (cards.length === 4 && counts.length === 2) {
    const tripleEntry = entries.find(e => e[1] === 3)
    const singleEntry = entries.find(e => e[1] === 1)
    if (tripleEntry && singleEntry) {
      return { type: 'triple_one', cards: sorted, mainRank: tripleEntry[0] }
    }
  }

  // 三带一对
  if (cards.length === 5 && counts.length === 2) {
    const tripleEntry = entries.find(e => e[1] === 3)
    const pairEntry = entries.find(e => e[1] === 2)
    if (tripleEntry && pairEntry) {
      return { type: 'triple_pair', cards: sorted, mainRank: tripleEntry[0] }
    }
  }

  // 顺子 (>=5张连续单张, 不含2和王)
  if (cards.length >= 5 && counts.every(c => c === 1)) {
    const allBelow2 = ranks.every(r => r < 12) // 12 = '2'
    const isConsecutive = ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1)
    if (allBelow2 && isConsecutive) {
      return { type: 'straight', cards: sorted, mainRank: ranks[ranks.length - 1] }
    }
  }

  return null // 不合法牌型
}

/** 比较两个牌型大小 (>0 表示 a 赢) */
export function compareCombo(a: CardCombo, b: CardCombo): number {
  // 火箭 > 一切
  if (a.type === 'rocket') return 1
  if (b.type === 'rocket') return -1

  // 炸弹 > 非炸弹
  if (a.type === 'bomb' && b.type !== 'bomb') return 1
  if (b.type === 'bomb' && a.type !== 'bomb') return -1

  // 同类型比较主牌面
  if (a.type !== b.type) return 0 // 不同类型(非炸弹)不可比
  if (a.cards.length !== b.cards.length) return 0 // 顺子长度不同不可比

  return a.mainRank - b.mainRank
}
