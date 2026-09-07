import { describe, expect, it } from 'vitest'
import { createDeck } from '@/games/poker/engine/card'
import { dealCards } from '@/games/poker/engine/deck'

describe('poker/engine/deck', () => {
  it('dealCards 从牌组顶部发出指定数量的牌', () => {
    const deck = createDeck()

    const { dealt, remaining } = dealCards(deck, 5)

    expect(dealt).toHaveLength(5)
    expect(remaining).toHaveLength(47)
    // 发出的是牌组前 5 张（顺序保持）
    expect(dealt).toEqual(deck.slice(0, 5))
    expect(remaining).toEqual(deck.slice(5))
  })

  it('dealCards 返回的 remaining 不包含已发出的牌', () => {
    const { dealt, remaining } = dealCards(createDeck(), 2)

    const dealtKeys = new Set(dealt.map((card) => `${card.rank}${card.suit}`))
    for (const card of remaining) {
      expect(dealtKeys.has(`${card.rank}${card.suit}`)).toBe(false)
    }
  })

  it('连续发牌可以完整耗尽整副牌组', () => {
    let remaining = createDeck()
    let dealtTotal = 0

    for (let i = 0; i < 26; i++) {
      const result = dealCards(remaining, 2)
      dealtTotal += result.dealt.length
      remaining = result.remaining
    }

    expect(dealtTotal).toBe(52)
    expect(remaining).toHaveLength(0)
  })

  it('发牌耗尽后再要牌会抛出含需求信息的错误', () => {
    const deck = createDeck().slice(0, 3)

    expect(() => dealCards(deck, 5)).toThrow(/Not enough cards: need 5, have 3/)
  })

  it('牌数恰好够时允许发牌（边界）', () => {
    const deck = createDeck().slice(0, 7)

    const { dealt, remaining } = dealCards(deck, 7)

    expect(dealt).toHaveLength(7)
    expect(remaining).toHaveLength(0)
  })
})
