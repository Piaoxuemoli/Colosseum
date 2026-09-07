import { describe, expect, it } from 'vitest'
import { calculateSidePots, mergePots } from '@/games/poker/engine/pot-manager'
import type { PlayerBet } from '@/games/poker/engine/pot-manager'

function bet(playerId: string, amount: number, opts: Partial<PlayerBet> = {}): PlayerBet {
  return { playerId, amount, isAllIn: false, isFolded: false, ...opts }
}

function totalOf(pots: Array<{ amount: number }>): number {
  return pots.reduce((sum, pot) => sum + pot.amount, 0)
}

describe('poker/engine/pot-manager calculateSidePots', () => {
  it('无入注时返回空数组', () => {
    expect(calculateSidePots([])).toEqual([])
  })

  it('所有人下注相等时只有主池', () => {
    const pots = calculateSidePots([bet('a', 100), bet('b', 100), bet('c', 100)])

    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(300)
    expect([...pots[0].eligiblePlayerIds].sort()).toEqual(['a', 'b', 'c'])
  })

  it('短码 all-in 玩家只对等额层有资格，其余进边池', () => {
    const pots = calculateSidePots([
      bet('a', 50, { isAllIn: true }),
      bet('b', 100),
      bet('c', 100),
    ])

    expect(pots).toHaveLength(2)
    expect(pots[0].amount).toBe(150)
    expect([...pots[0].eligiblePlayerIds].sort()).toEqual(['a', 'b', 'c'])
    expect(pots[1].amount).toBe(100)
    expect([...pots[1].eligiblePlayerIds].sort()).toEqual(['b', 'c'])
  })

  it('弃牌玩家贡献筹码但无获奖资格（死钱）', () => {
    const pots = calculateSidePots([bet('a', 100, { isFolded: true }), bet('b', 100), bet('c', 100)])

    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(300)
    expect([...pots[0].eligiblePlayerIds].sort()).toEqual(['b', 'c'])
  })

  it('多层 all-in：每层金额 = 层差 × 贡献人数', () => {
    const pots = calculateSidePots([
      bet('a', 30, { isAllIn: true }),
      bet('b', 70, { isAllIn: true }),
      bet('c', 100),
      bet('d', 100, { isFolded: true }),
    ])

    // 层 0-30：4 人贡献 → 120，a/b/c 有资格（d 弃牌）
    // 层 30-70：b/c/d 贡献 → 120，b/c 有资格
    // 层 70-100：c/d 贡献 → 60，仅 c 有资格
    expect(pots).toHaveLength(3)
    expect(pots[0]).toEqual({ amount: 120, eligiblePlayerIds: ['a', 'b', 'c'] })
    expect(pots[1]).toEqual({ amount: 120, eligiblePlayerIds: ['b', 'c'] })
    expect(pots[2]).toEqual({ amount: 60, eligiblePlayerIds: ['c'] })
    expect(totalOf(pots)).toBe(300)
  })

  it('最高层全是弃牌死钱时滚入前一个池', () => {
    const pots = calculateSidePots([
      bet('a', 50),
      bet('b', 50),
      bet('c', 120, { isFolded: true }),
    ])

    // 层 0-50：主池 150（a/b 有资格）
    // 层 50-120：只有弃牌的 c 贡献，死钱 70 归入主池
    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(220)
    expect([...pots[0].eligiblePlayerIds].sort()).toEqual(['a', 'b'])
  })

  it('两个 all-in 层 + 跟注者的三池结构', () => {
    const pots = calculateSidePots([
      bet('a', 20, { isAllIn: true }),
      bet('b', 60, { isAllIn: true }),
      bet('c', 60),
      bet('d', 60),
    ])

    expect(pots.map((pot) => pot.amount)).toEqual([80, 120])
    expect(pots[0].eligiblePlayerIds).toEqual(['a', 'b', 'c', 'd'])
    expect([...pots[1].eligiblePlayerIds].sort()).toEqual(['b', 'c', 'd'])
    expect(totalOf(pots)).toBe(200)
  })

  it('零注玩家不产生层级', () => {
    const pots = calculateSidePots([bet('a', 0), bet('b', 40), bet('c', 40)])

    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(80)
    expect([...pots[0].eligiblePlayerIds].sort()).toEqual(['b', 'c'])
  })

  it('复杂场景下筹码守恒（总池 = 总入注）', () => {
    const bets = [
      bet('a', 17, { isAllIn: true }),
      bet('b', 53, { isAllIn: true, isFolded: false }),
      bet('c', 88),
      bet('d', 88, { isFolded: true }),
      bet('e', 41),
    ]

    const pots = calculateSidePots(bets)

    const totalIn = bets.reduce((sum, entry) => sum + entry.amount, 0)
    expect(totalOf(pots)).toBe(totalIn)
    expect(pots.length).toBeGreaterThan(1)
  })
})

describe('poker/engine/pot-manager mergePots', () => {
  it('按顺序拼接两个池列表', () => {
    const existing = [{ amount: 100, eligiblePlayerIds: ['a', 'b'] }]
    const added = [{ amount: 40, eligiblePlayerIds: ['b'] }]

    const merged = mergePots(existing, added)

    expect(merged).toHaveLength(2)
    expect(merged[0].amount).toBe(100)
    expect(merged[1].amount).toBe(40)
  })
})
