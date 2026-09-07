import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from '@/games/poker/engine/card'
import { HandRank, compareHands, evaluateHand } from '@/games/poker/engine/evaluator'

const SUIT_MAP = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const

function c(code: string): Card {
  return {
    rank: code[0] as Rank,
    suit: SUIT_MAP[code[1] as keyof typeof SUIT_MAP],
  }
}

function cards(...codes: string[]): Card[] {
  return codes.map(c)
}

// 输出 bestCards 时按 rank+suit 重新编码，便于断言
function cardCode(card: Card): string {
  const suitChar: Record<Suit, string> = { hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' }
  return `${card.rank}${suitChar[card.suit]}`
}

function handCodes(hand: Card[]): string[] {
  return hand.map(cardCode).sort()
}

describe('poker/engine/evaluator 牌型判定', () => {
  it('少于 5 张牌时抛错', () => {
    expect(() => evaluateHand(cards('Ah', 'Kh', 'Qh', 'Jh'))).toThrow(/at least 5/)
  })

  it('高牌：rank=1，values 按五张牌降序', () => {
    const result = evaluateHand(cards('Ah', 'Kc', 'Qd', 'Jh', '9s'))

    expect(result.rank).toBe(HandRank.HighCard)
    expect(result.values).toEqual([14, 13, 12, 11, 9])
    expect(result.rankName).toBe('High Card')
    expect(result.bestCards).toHaveLength(5)
  })

  it('一对：values = [对子点数, 三个 kicker 降序]', () => {
    const result = evaluateHand(cards('9h', '9d', 'Ac', 'Kh', 'Qs'))

    expect(result.rank).toBe(HandRank.OnePair)
    expect(result.values).toEqual([9, 14, 13, 12])
  })

  it('两对：大对在前，第五张为 kicker', () => {
    const result = evaluateHand(cards('Ah', 'Ad', 'Kc', 'Kh', 'Qs'))

    expect(result.rank).toBe(HandRank.TwoPair)
    expect(result.values).toEqual([14, 13, 12])
  })

  it('三条：values = [三条点数, 两个 kicker 降序]', () => {
    const result = evaluateHand(cards('8h', '8d', '8c', 'Ks', 'Jh'))

    expect(result.rank).toBe(HandRank.ThreeOfAKind)
    expect(result.values).toEqual([8, 13, 11])
  })

  it('顺子：T-J-Q-K-A（Broadway）以 A 为高张', () => {
    const result = evaluateHand(cards('Th', 'Jc', 'Qd', 'Kh', 'As'))

    expect(result.rank).toBe(HandRank.Straight)
    expect(result.values).toEqual([14])
  })

  it('顺子：A-2-3-4-5（轮子）以 5 为高张', () => {
    const result = evaluateHand(cards('Ah', '2c', '3d', '4h', '5s'))

    expect(result.rank).toBe(HandRank.Straight)
    expect(result.values).toEqual([5])
  })

  it('同花：values 为五张牌降序', () => {
    const result = evaluateHand(cards('Ah', 'Jh', '9h', '5h', '3h'))

    expect(result.rank).toBe(HandRank.Flush)
    expect(result.values).toEqual([14, 11, 9, 5, 3])
  })

  it('葫芦：values = [三条点数, 对子点数]', () => {
    const result = evaluateHand(cards('Qh', 'Qd', 'Qc', '7s', '7h'))

    expect(result.rank).toBe(HandRank.FullHouse)
    expect(result.values).toEqual([12, 7])
  })

  it('四条：values = [四条点数, kicker]', () => {
    const result = evaluateHand(cards('4h', '4d', '4c', '4s', 'Ah'))

    expect(result.rank).toBe(HandRank.FourOfAKind)
    expect(result.values).toEqual([4, 14])
  })

  it('同花顺：rank=9，values = [高张]', () => {
    const result = evaluateHand(cards('5h', '6h', '7h', '8h', '9h'))

    expect(result.rank).toBe(HandRank.StraightFlush)
    expect(result.values).toEqual([9])
    expect(result.rankName).toBe('Straight Flush')
  })

  it('皇家同花顺：rankName 标记为 Royal Flush', () => {
    const result = evaluateHand(cards('Th', 'Jh', 'Qh', 'Kh', 'Ah'))

    expect(result.rank).toBe(HandRank.StraightFlush)
    expect(result.values).toEqual([14])
    expect(result.rankName).toBe('Royal Flush')
  })
})

describe('poker/engine/evaluator 牌型大小（value 编码单调）', () => {
  it('九级牌型自上而下严格递减', () => {
    const hands = [
      evaluateHand(cards('Th', 'Jh', 'Qh', 'Kh', 'Ah')), // 同花顺
      evaluateHand(cards('4h', '4d', '4c', '4s', 'Ah')), // 四条
      evaluateHand(cards('Qh', 'Qd', 'Qc', '7s', '7h')), // 葫芦
      evaluateHand(cards('Ah', 'Jh', '9h', '5h', '3h')), // 同花
      evaluateHand(cards('Th', 'Jc', 'Qd', 'Kh', 'As')), // 顺子
      evaluateHand(cards('8h', '8d', '8c', 'Ks', 'Jh')), // 三条
      evaluateHand(cards('Ah', 'Ad', 'Kc', 'Kh', 'Qs')), // 两对
      evaluateHand(cards('9h', '9d', 'Ac', 'Kh', 'Qs')), // 一对
      evaluateHand(cards('Ah', 'Kc', 'Qd', 'Jh', '9s')), // 高牌
    ]

    for (let i = 1; i < hands.length; i++) {
      expect(hands[i - 1].value).toBeGreaterThan(hands[i].value)
    }
  })

  it('轮子顺子输给 6 高顺子', () => {
    const wheel = evaluateHand(cards('Ah', '2c', '3d', '4h', '5s'))
    const six = evaluateHand(cards('6h', '2c', '3d', '4h', '5s'))

    expect(six.value).toBeGreaterThan(wheel.value)
  })

  it('同级牌型按 values 逐位比较：第 5 张 kicker 分胜负', () => {
    const ak = evaluateHand(cards('Ah', 'Kc', 'Qd', 'Jh', '9s'))
    const aq = evaluateHand(cards('As', 'Kh', 'Qc', 'Jd', '8c'))

    expect(compareHands(ak, aq)).toBeGreaterThan(0)
    expect(compareHands(aq, ak)).toBeLessThan(0)
  })

  it('两对先比大对子：AA22 胜过 KKQQ', () => {
    const acesUp = evaluateHand(cards('Ah', 'Ad', '2c', '2h', '5s'))
    const kingsUp = evaluateHand(cards('Kh', 'Kd', 'Qc', 'Qh', '5s'))

    expect(acesUp.value).toBeGreaterThan(kingsUp.value)
  })

  it('一对点数相同时比 kicker 链', () => {
    const withAceKicker = evaluateHand(cards('9h', '9d', 'Ac', '7h', '5s'))
    const withKingKicker = evaluateHand(cards('9c', '9s', 'Kh', '7c', '5d'))

    expect(withAceKicker.value).toBeGreaterThan(withKingKicker.value)
  })

  it('完全同强度的两手牌打平（平分底池）', () => {
    const a = evaluateHand(cards('Ah', 'Kc', 'Qd', 'Jh', '9s'))
    const b = evaluateHand(cards('As', 'Kh', 'Qc', 'Jd', '9c'))

    expect(compareHands(a, b)).toBe(0)
    expect(a.value).toBe(b.value)
  })
})

describe('poker/engine/evaluator 7 张选最优 5 张', () => {
  it('底牌对 + 底牌 A 组成葫芦', () => {
    const result = evaluateHand([...cards('Ah', 'Ad'), ...cards('As', 'Kc', 'Kd', '2c', '3d')])

    expect(result.rank).toBe(HandRank.FullHouse)
    expect(result.values).toEqual([14, 13])
    expect(result.bestCards).toHaveLength(5)
    expect(handCodes(result.bestCards)).toEqual(handCodes(cards('Ah', 'Ad', 'As', 'Kc', 'Kd')))
  })

  it('6 张同花时选出最大的 5 张', () => {
    const result = evaluateHand([...cards('2h', '7h'), ...cards('9h', 'Th', 'Jh', 'Kh', 'Ac')])

    expect(result.rank).toBe(HandRank.Flush)
    expect(result.values).toEqual([13, 11, 10, 9, 7])
    expect(handCodes(result.bestCards)).toEqual(handCodes(cards('Kh', 'Jh', 'Th', '9h', '7h')))
  })

  it('三对共存时取最大的两对加最高 kicker', () => {
    const result = evaluateHand([...cards('Ah', 'As'), ...cards('Kc', 'Kd', 'Qh', 'Qs', 'Jc')])

    expect(result.rank).toBe(HandRank.TwoPair)
    expect(result.values).toEqual([14, 13, 12])
  })

  it('对子干扰下仍能凑出顺子', () => {
    const result = evaluateHand([...cards('5c', '9d'), ...cards('7h', '8s', 'Kc', 'Kd', '6h')])

    expect(result.rank).toBe(HandRank.Straight)
    expect(result.values).toEqual([9])
  })

  it('公共牌完全主导时 bestCards 就是公共牌 5 张', () => {
    const board = cards('Ah', 'Kd', '9s', '7c', '4h')
    const result = evaluateHand([...cards('2c', '3d'), ...board])

    expect(result.rank).toBe(HandRank.HighCard)
    expect(result.values).toEqual([14, 13, 9, 7, 4])
    expect(handCodes(result.bestCards)).toEqual(handCodes(board))
  })

  it('7 张牌里的轮子顺子与 6 高顺子比较仍按高张判定', () => {
    const wheel = evaluateHand([...cards('Ah', '2c'), ...cards('3d', '4h', '5s', 'Kh', 'Kd')])
    const six = evaluateHand([...cards('Ah', '6c'), ...cards('3d', '4h', '5s', '2h', 'Kd')])

    expect(wheel.rank).toBe(HandRank.Straight)
    expect(six.rank).toBe(HandRank.Straight)
    expect(six.value).toBeGreaterThan(wheel.value)
  })
})
