// AC-12 / PFR-201：牌型比较系统用例（10 类牌型、kicker 逐位、打板平局、轮子、花色不破平）。

import { describe, expect, it } from 'vitest'
import { CATEGORY_RANK, compareEvaluations, evaluate5, evaluateBest } from '@/games/poker/engine2'
import { cardsFromCodes } from './testkit'

function ev(codes: string[]) {
  return evaluate5(cardsFromCodes(codes))
}

describe('AC-12 牌型类别与比较键', () => {
  it('高牌：五张降序比较键', () => {
    const r = ev(['Ah', 'Kc', 'Qd', 'Jh', '9s'])
    expect(r.category).toBe('high-card')
    expect(r.tiebreak).toEqual([14, 13, 12, 11, 9])
  })

  it('一对：对子点数 + 三张 kicker', () => {
    const r = ev(['Ah', 'Ac', 'Kd', '9h', '3s'])
    expect(r.category).toBe('one-pair')
    expect(r.tiebreak).toEqual([14, 13, 9, 3])
  })

  it('两对：大对 → 小对 → kicker', () => {
    const r = ev(['Ah', 'Ac', 'Kd', 'Kh', '9s'])
    expect(r.category).toBe('two-pair')
    expect(r.tiebreak).toEqual([14, 13, 9])
  })

  it('三条：三条点数 + 两张 kicker', () => {
    const r = ev(['Ah', 'Ac', 'Ad', 'Kd', '9s'])
    expect(r.category).toBe('three-of-a-kind')
    expect(r.tiebreak).toEqual([14, 13, 9])
  })

  it('顺子：最高牌比较；轮子 A-2-3-4-5 以 5 为高（最小顺子）', () => {
    const wheel = ev(['Ah', '2c', '3d', '4h', '5s'])
    const six = ev(['2c', '3d', '4h', '5s', '6c'])
    expect(wheel.category).toBe('straight')
    expect(wheel.tiebreak).toEqual([5])
    expect(six.tiebreak).toEqual([6])
    expect(compareEvaluations(six, wheel)).toBeGreaterThan(0)
  })

  it('同花：五张逐张比较', () => {
    const r = ev(['Ah', 'Kh', '9h', '6h', '3h'])
    expect(r.category).toBe('flush')
    expect(r.tiebreak).toEqual([14, 13, 9, 6, 3])
  })

  it('葫芦：三条点数 → 对子点数', () => {
    const r = ev(['Ah', 'Ac', 'Ad', 'Kh', 'Kd'])
    expect(r.category).toBe('full-house')
    expect(r.tiebreak).toEqual([14, 13])
  })

  it('四条：四条点数 → kicker', () => {
    const r = ev(['Ah', 'Ac', 'Ad', 'As', 'Kh'])
    expect(r.category).toBe('four-of-a-kind')
    expect(r.tiebreak).toEqual([14, 13])
  })

  it('同花顺与皇家同花顺（皇家为同花顺特例）', () => {
    const sf = ev(['5h', '6h', '7h', '8h', '9h'])
    expect(sf.category).toBe('straight-flush')
    expect(sf.tiebreak).toEqual([9])
    const royal = ev(['Th', 'Jh', 'Qh', 'Kh', 'Ah'])
    expect(royal.category).toBe('straight-flush')
    expect(royal.name).toBe('Royal Flush')
    expect(royal.tiebreak).toEqual([14])
  })

  it('钢轮（同花 A-5）是最低同花顺', () => {
    const steel = ev(['Ah', '2h', '3h', '4h', '5h'])
    expect(steel.category).toBe('straight-flush')
    expect(steel.tiebreak).toEqual([5])
    const any = ev(['5h', '6h', '7h', '8h', '9h'])
    expect(compareEvaluations(any, steel)).toBeGreaterThan(0)
  })

  it('类别排序：straight-flush > quads > full house > flush > straight > trips > two pair > pair > high', () => {
    const samples = [
      ev(['Ah', 'Ac', 'Kd', 'Qh', '9s']), // pair
      ev(['Ah', 'Ac', 'Kd', 'Kh', '9s']), // two pair
      ev(['Ah', 'Ac', 'Ad', 'Kd', '9s']), // trips
      ev(['5h', '6c', '7d', '8h', '9s']), // straight
      ev(['Ah', 'Kh', '9h', '6h', '3h']), // flush
      ev(['Ah', 'Ac', 'Ad', 'Kh', 'Kd']), // full house
      ev(['Ah', 'Ac', 'Ad', 'As', 'Kh']), // quads
      ev(['5h', '6h', '7h', '8h', '9h']), // sf
    ]
    for (let i = 1; i < samples.length; i++) {
      expect(compareEvaluations(samples[i], samples[i - 1])).toBeGreaterThan(0)
    }
    expect(CATEGORY_RANK['one-pair']).toBeLessThan(CATEGORY_RANK['two-pair'])
  })
})

describe('AC-12 kicker 逐位比较与平局', () => {
  it('一对 A：K kicker 胜 Q kicker', () => {
    const withK = ev(['Ah', 'Ac', 'Kd', '9h', '3s'])
    const withQ = ev(['As', 'Ad', 'Qd', '9h', '3s'])
    expect(compareEvaluations(withK, withQ)).toBeGreaterThan(0)
  })

  it('两对同型：第五张 kicker 决胜', () => {
    const a = ev(['Ah', 'Ac', 'Kd', 'Kh', '9s'])
    const b = ev(['As', 'Ad', 'Ks', 'Kd', 'Js'])
    expect(compareEvaluations(b, a)).toBeGreaterThan(0)
  })

  it('花色不破平：同点数同牌型必平局（PFR-201）', () => {
    const a = ev(['Ah', 'Ac', 'Kd', 'Qh', '9s'])
    const b = ev(['As', 'Ad', 'Kc', 'Qs', '9c'])
    expect(compareEvaluations(a, b)).toBe(0)
    expect(a.value).toBe(b.value)
  })

  it('打板平局：公共牌 A-A-K-Q-J，双方底牌不参与（PFR-201 验收例）', () => {
    const board = ['Ah', 'Ad', 'Kh', 'Qc', 'Jd']
    const p1 = evaluateBest(cardsFromCodes([...board, '2c', '3d']))
    const p2 = evaluateBest(cardsFromCodes([...board, '4h', '5h']))
    expect(p1.category).toBe('one-pair')
    expect(p1.tiebreak).toEqual([14, 13, 12, 11])
    expect(p2.tiebreak).toEqual([14, 13, 12, 11])
    expect(compareEvaluations(p1, p2)).toBe(0)
  })
})

describe('best 5 of 7（PFR-201）', () => {
  it('底牌 0 张参与：板面四条 A 时最优五张全来自公共牌', () => {
    const r = evaluateBest(cardsFromCodes(['Ah', 'Ac', 'Ad', 'As', 'Kh', '2c', '3d']))
    expect(r.category).toBe('four-of-a-kind')
    expect(r.tiebreak).toEqual([14, 13])
    expect(r.best5.map((c) => `${c.rank}${c.suit}`)).not.toContain('2c')
  })

  it('底牌 1 张参与：A-K-Q-J 板面配 T 成大顺', () => {
    const r = evaluateBest(cardsFromCodes(['Ah', 'Kd', 'Qs', 'Jh', 'Th', '2c', '3d']))
    expect(r.category).toBe('straight')
    expect(r.tiebreak).toEqual([14])
  })

  it('hole 两对被板面更好的两对覆盖时仍取最优五张', () => {
    const r = evaluateBest(cardsFromCodes(['Ah', 'Ad', 'Kc', 'Kh', '2s', '3c', '4d']))
    expect(r.category).toBe('two-pair')
    expect(r.tiebreak).toEqual([14, 13, 4])
  })

  it('7 张评估 == 21 种五张组合取最强（规范语义）', () => {
    const cards = cardsFromCodes(['Ah', 'Kd', 'Ks', '7c', '7d', '3h', '3s'])
    const best = evaluateBest(cards)
    let max = evaluate5(cards.slice(0, 5))
    for (let i = 0; i < 7; i++) {
      for (let j = i + 1; j < 7; j++) {
        const five = cards.filter((_, idx) => idx !== i && idx !== j)
        const e5 = evaluate5(five)
        if (compareEvaluations(e5, max) > 0) max = e5
      }
    }
    expect(best.value).toBe(max.value)
    expect(best.category).toBe('two-pair')
    expect(best.tiebreak).toEqual([13, 7, 14])
  })
})
