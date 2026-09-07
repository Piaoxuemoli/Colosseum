import { describe, expect, it } from 'vitest'
import { RANKS, SUITS, cardToString, createDeck, rankValue, shuffleDeck } from '@/games/poker/engine/card'

describe('poker/engine/card', () => {
  it('createDeck 生成 52 张不重复的牌', () => {
    const deck = createDeck()

    expect(deck).toHaveLength(52)
    expect(new Set(deck.map((card) => `${card.rank}-${card.suit}`)).size).toBe(52)
  })

  it('createDeck 覆盖每种花色的每个点数', () => {
    const deck = createDeck()
    for (const suit of SUITS) {
      const ranksOfSuit = new Set(deck.filter((card) => card.suit === suit).map((card) => card.rank))
      expect([...ranksOfSuit].sort()).toEqual([...RANKS].sort())
    }
  })

  it('createDeck 顺序确定：花色为主序，点数从小到大', () => {
    const deck = createDeck()

    expect(deck[0]).toEqual({ rank: '2', suit: 'hearts' })
    expect(deck[12]).toEqual({ rank: 'A', suit: 'hearts' })
    expect(deck[13]).toEqual({ rank: '2', suit: 'diamonds' })
    expect(deck[51]).toEqual({ rank: 'A', suit: 'spades' })
  })

  it('rankValue：A 最大（14），2 最小（2），T 为 10', () => {
    expect(rankValue('2')).toBe(2)
    expect(rankValue('T')).toBe(10)
    expect(rankValue('J')).toBe(11)
    expect(rankValue('Q')).toBe(12)
    expect(rankValue('K')).toBe(13)
    expect(rankValue('A')).toBe(14)
  })

  it('rankValue 与 RANKS 声明顺序保持单调递增', () => {
    const values = RANKS.map((rank) => rankValue(rank))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1])
    }
  })

  it('cardToString 输出 <rank><suit> 两字符格式', () => {
    expect(cardToString({ rank: 'A', suit: 'hearts' })).toBe('Ah')
    expect(cardToString({ rank: 'T', suit: 'diamonds' })).toBe('Td')
    expect(cardToString({ rank: '7', suit: 'clubs' })).toBe('7c')
    expect(cardToString({ rank: '2', suit: 'spades' })).toBe('2s')
  })

  describe('shuffleDeck', () => {
    it('相同 RNG 序列得到相同洗牌结果（确定性）', () => {
      const sequence = () => {
        const values = [0.42, 0.1, 0.9, 0.5, 0.33, 0.77, 0.05, 0.61, 0.88, 0.14]
        let i = 0
        return () => values[i++ % values.length] as number
      }

      const a = shuffleDeck(createDeck(), sequence())
      const b = shuffleDeck(createDeck(), sequence())

      expect(a.map(cardToString)).toEqual(b.map(cardToString))
    })

    it('洗牌保持牌的集合不变（仍是同一副 52 张）', () => {
      const original = createDeck()
      const shuffled = shuffleDeck(original, () => 0.3)

      const key = (cards: typeof original) =>
        [...cards].map((card) => cardToString(card)).sort().join(',')

      expect(key(shuffled)).toBe(key(original))
      expect(shuffled).toHaveLength(52)
    })

    it('洗牌不修改原始牌组（返回新数组）', () => {
      const original = createDeck()
      const snapshot = original.map(cardToString)

      const shuffled = shuffleDeck(original, () => 0.3)

      expect(shuffled).not.toBe(original)
      expect(original.map(cardToString)).toEqual(snapshot)
    })

    it('不同 RNG 通常产生不同顺序', () => {
      const first = shuffleDeck(createDeck(), () => 0.42)
      const second = shuffleDeck(createDeck(), () => 0.13)

      expect(first.map(cardToString)).not.toEqual(second.map(cardToString))
    })
  })
})
