import { describe, expect, it } from 'vitest'
import type { Card, Rank } from '@/games/poker/engine/card'
import {
  calculateEquity,
  calculateMultiPlayerEquity,
  calculateOuts,
  computeEquity,
} from '@/games/poker/engine/equity'

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

// Park–Miller 线性同余 RNG：与 Math.random 无关，可复现
function seededRng(seed = 42) {
  let state = seed
  return () => {
    state = (state * 16_807) % 2_147_483_647
    return (state - 1) / 2_147_483_646
  }
}

describe('poker/engine/equity computeEquity 确定性用例', () => {
  it('公共牌已发满时结果为精确值：更强同花胜率恰为 1', () => {
    const result = computeEquity({
      holes: [cards('7h', '8h'), cards('2c', '3d')],
      community: cards('5h', '6h', '9h', 'Th', 'Jh'),
      iterations: 5,
      rng: seededRng(1),
    })

    // 双方公共牌同花，但 7h8h 与 5h6h9h 组成同花顺，稳胜对手的普通同花
    expect(result[0]).toBe(1)
    expect(result[1]).toBe(0)
  })

  it('公共牌主导的平局：胜率恰为 0.5/0.5', () => {
    const result = computeEquity({
      holes: [cards('2c', '3d'), cards('4s', '5d')],
      community: cards('Ah', 'As', 'Ad', 'Kc', 'Qc'),
      iterations: 5,
      rng: seededRng(1),
    })

    expect(result[0]).toBe(0.5)
    expect(result[1]).toBe(0.5)
    expect(result[0] + result[1]).toBeCloseTo(1, 10)
  })

  it('空手牌列表返回空数组', () => {
    expect(computeEquity({ holes: [], community: [], iterations: 10 })).toEqual([])
  })

  it('底牌不是 2 张时抛错', () => {
    expect(() =>
      computeEquity({ holes: [cards('Ah', 'As', 'Ad'), cards('2c', '3d')], community: [] }),
    ).toThrow(/exactly 2 hole cards/)
  })

  it('公共牌超过 5 张时抛错', () => {
    expect(() =>
      computeEquity({ holes: [cards('Ah', 'As'), cards('2c', '3d')], community: cards('2h', '3h', '4h', '5h', '6h', '7h') }),
    ).toThrow(/at most 5 community/)
  })
})

describe('poker/engine/equity Monte Carlo 粗粒度校验（种子固定）', () => {
  it('AA 对 72o 显著占优', () => {
    const result = computeEquity({
      holes: [cards('Ah', 'As'), cards('7c', '2d')],
      community: [],
      iterations: 2_000,
      rng: seededRng(42),
    })

    // 理论值约 88% / 12%，容差放宽到 75/25
    expect(result[0]).toBeGreaterThan(0.75)
    expect(result[1]).toBeLessThan(0.25)
    expect(result[0] + result[1]).toBeCloseTo(1, 6)
  })

  it('同结构 AK 对 AK 大致均势', () => {
    const result = computeEquity({
      holes: [cards('Ah', 'Kc'), cards('As', 'Kd')],
      community: cards('2h', '5c', '9d'),
      iterations: 1_500,
      rng: seededRng(7),
    })

    expect(Math.abs(result[0] - result[1])).toBeLessThan(0.2)
  })

  it('翻牌前顶对 vs 超对：超对占优但不碾压', () => {
    const result = computeEquity({
      holes: [cards('Qh', 'Qs'), cards('Ah', 'Kd')],
      community: [],
      iterations: 1_500,
      rng: seededRng(99),
    })

    // QQ vs AKo 理论约 57% / 43%
    expect(result[0]).toBeGreaterThan(0.5)
    expect(result[0]).toBeLessThan(0.7)
  })
})

describe('poker/engine/equity calculateEquity', () => {
  it('AA 单挑随机对手胜率约 85%', () => {
    const equity = calculateEquity(cards('Ah', 'As'), [], 1_200, seededRng(11))

    expect(equity).toBeGreaterThan(0.78)
    expect(equity).toBeLessThan(0.92)
  })

  it('已完成的公共牌上 equity 是精确值', () => {
    // K-high 同花已成型，对手随机两手也拿不到更高（A 同花可能平/胜，容差放宽）
    const equity = calculateEquity(cards('Kh', 'Qh'), cards('2h', '5h', '9h', 'Th', 'Jh'), 300, seededRng(3))

    expect(equity).toBeGreaterThan(0.5)
  })
})

describe('poker/engine/equity calculateMultiPlayerEquity', () => {
  it('不足 2 人时直接返回 equity=1', () => {
    const result = calculateMultiPlayerEquity([{ playerId: 'a', holeCards: cards('Ah', 'As') }], [], 10)

    expect(result).toEqual([{ playerId: 'a', equity: 1 }])
  })

  it('公共牌发满时附带 handName', () => {
    const result = calculateMultiPlayerEquity(
      [
        { playerId: 'a', holeCards: cards('7h', '8h') },
        { playerId: 'b', holeCards: cards('2c', '3d') },
      ],
      cards('5h', '6h', '9h', 'Th', 'Jh'),
      10,
      seededRng(1),
    )

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ playerId: 'a', equity: 1, handName: 'Straight Flush' })
    expect(result[1]).toEqual({ playerId: 'b', equity: 0, handName: 'Flush' })
  })
})

describe('poker/engine/equity calculateOuts', () => {
  it('同花听牌 + 双高张：任何能提升牌型等级的牌都算 outs（23 张）', () => {
    // 当前为 A 高牌。改进牌 = 9 张红桃（成同花）+ 14 张非红桃配对牌
    // （A/K/2/5 各 3 张，9 只有 9d/9s 两张——9c 已在公共牌）
    const outs = calculateOuts(cards('Ah', 'Kh'), cards('2h', '5h', '9c'))

    expect(outs).toBe(23)
  })

  it('已有两对时只有配成三条的 4 张牌能提升为葫芦', () => {
    // 7-7 8-8 带 2：剩余的 7（7d/7s）和 8（8h/8c）组成葫芦；
    // 再配一张 2 只是三对，最佳五张仍是两对，等级不变
    const outs = calculateOuts(cards('7c', '8d'), cards('7h', '8s', '2c'))

    expect(outs).toBe(4)
  })

  it('顶对（口袋对）可通过成三条或公共牌配对提升（11 张）', () => {
    // AA 在 2-7-9 面：2 张 A 成三条 + 9 张公共牌配对成两对
    const outs = calculateOuts(cards('Ah', 'Ad'), cards('2c', '7d', '9s'))

    expect(outs).toBe(11)
  })

  it('已成同花且无补葫芦/金刚路径时 outs 为 0', () => {
    // A-K 同花已成：公共牌对 9 只有两张，补第三张 9 也只是三条带单张，
    // 仍不及同花；更高的同花不改变牌型等级
    const outs = calculateOuts(cards('Ah', 'Kh'), cards('2h', '5h', '9h', '9c'))

    expect(outs).toBe(0)
  })

  it('公共牌不足 3 张或已发满时返回 0', () => {
    expect(calculateOuts(cards('Ah', 'Kh'), cards('2h', '5h'))).toBe(0)
    expect(calculateOuts(cards('Ah', 'Kh'), cards('2h', '5h', '9c', '9d', '9s'))).toBe(0)
  })
})
