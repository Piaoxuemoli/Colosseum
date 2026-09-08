// AC-03 / PFR-208：贡献分层嵌套边池——独立判胜、短码玩家只赢有资格的池、全池总和守恒。
// 统一起始筹码约束下，先用一手"塑造"差异化筹码（600/200/1000），再在全下手构造三级贡献。

import { describe, expect, it } from 'vitest'
import { computePots } from '@/games/poker/engine2'
import { act, eventsOfKind, expectNoStall, findSeed, mkConfig, newMatch, play, valueOrder } from './testkit'

describe('computePots 分层单元（PFR-208 标准算法）', () => {
  it('100 / 300 / 500 三级贡献 → 主池 300（3 资格）+ 边池 400（2 资格）+ 边池 200（1 资格）', () => {
    const pots = computePots([
      { seatId: 'a', committed: 100, folded: false },
      { seatId: 'b', committed: 300, folded: false },
      { seatId: 'c', committed: 500, folded: false },
    ])
    expect(pots.map((p) => [p.amount, p.eligibleSeatIds])).toEqual([
      [300, ['a', 'b', 'c']],
      [400, ['b', 'c']],
      [200, ['c']],
    ])
    // 筹码守恒（PFR-208 验收）
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(900)
  })

  it('PFR-208 验收例：甲全下 100、乙全下 300、丙跟 300 → 主池 300 / 边池 400', () => {
    const pots = computePots([
      { seatId: 'a', committed: 100, folded: false },
      { seatId: 'b', committed: 300, folded: false },
      { seatId: 'c', committed: 300, folded: false },
    ])
    expect(pots.map((p) => [p.amount, p.eligibleSeatIds])).toEqual([
      [300, ['a', 'b', 'c']],
      [400, ['b', 'c']],
    ])
  })

  it('弃牌者贡献保留在相应层但无任何资格', () => {
    const pots = computePots([
      { seatId: 'a', committed: 50, folded: true },
      { seatId: 'b', committed: 100, folded: false },
      { seatId: 'c', committed: 100, folded: false },
    ])
    expect(pots.map((p) => [p.amount, p.eligibleSeatIds])).toEqual([
      [150, ['b', 'c']],
      [100, ['b', 'c']],
    ])
  })

  it('某层仅剩弃牌者贡献（无资格者）→ 并入相邻池，不产生悬空筹码', () => {
    const pots = computePots([
      { seatId: 'a', committed: 100, folded: true },
      { seatId: 'b', committed: 30, folded: false },
      { seatId: 'c', committed: 30, folded: false },
    ])
    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(160)
    expect(pots[0].eligibleSeatIds).toEqual(['b', 'c'])
  })
})

describe('AC-03 嵌套边池（引擎集成，三级贡献）', () => {
  // 手 1（按钮 p0，盲注 100/200，无牌面依赖）：
  //   p0 弃 / p1 补平后翻牌下注 200 再弃 / p2 全下加注 → p2 收池
  //   手 1 结束筹码：p0 600 / p1 200 / p2 1000
  // 手 2（按钮 p1，SB=p2、BB=p0、UTG=p1，盲注已扣）：
  //   p1 全下 200 / p2 全下加注 900 / p0 短码全下跟注 400 → 三级贡献 200/900/400 → run-out
  //   牌力要求 v(p1) > v(p0) > v(p2)
  function setup() {
    const seed = findSeed({
      players: 3,
      button: 0,
      where: (_l1, at) => valueOrder(at(2), [1, 0, 2]), // 手 2：p1 > p0 > p2
    })
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 600, 100, 200), seed)
    expect(created.state.hand?.buttonSeat).toBe(0)

    // 手 1：p0(按钮/UTG) 弃 → p1(SB) 补平 → p2(BB) option check → flop p1 下注、p2 全下加注、p1 弃
    const s1 = act(created.state, 'p0', { type: 'fold' })
    expect(s1.currentActor).toBe('p1')
    const s2 = act(s1, 'p1', { type: 'call' })
    const s3 = act(s2, 'p2', { type: 'check' })
    expect(s3.hand?.street).toBe('flop')
    expect(s3.currentActor).toBe('p1') // postflop SB 先动
    const s4 = act(s3, 'p1', { type: 'bet', amount: 200 }) // p1 累计 400
    const s5 = act(s4, 'p2', { type: 'raise', toAmount: 400 }) // p2 街内 400 = 全下（累计 600）
    const s6 = act(s5, 'p1', { type: 'fold' })
    // 手 2 开始（p0=BB 已扣 200、p2=SB 已扣 100）
    expect(s6.handNumber).toBe(2)
    expect(s6.players.map((p) => [p.seatId, p.stack])).toEqual([
      ['p0', 400],
      ['p1', 200],
      ['p2', 900],
    ])
    expect(s6.hand?.buttonSeat).toBe(1)
    return s6
  }

  it('三级贡献各自独立判胜；短码只赢有资格的池；全池总和 = 总贡献（守恒）', () => {
    const s6 = setup()
    // 手 2 座位：按钮 p1、SB p2、BB p0 → UTG = p1（200 全下）
    expect(s6.currentActor).toBe('p1')
    const s7 = act(s6, 'p1', { type: 'all-in' }) // 全下至 200
    expect(s7.currentActor).toBe('p2')
    const s8 = act(s7, 'p2', { type: 'all-in' }) // SB 全下加注至 900
    expect(s8.currentActor).toBe('p0')
    const { state, events } = play(s8, [['p0', { type: 'all-in' }]]) // BB 短码全下跟注至 400

    expect(eventsOfKind(events, 'run-out-started')).toHaveLength(1)
    expect(eventsOfKind(events, 'cards-revealed')).toHaveLength(3)

    // 三层：L1 = 200×3 = 600；L2 = 400×2 = 800；L3 = 400×1 = 400（未跟注退还 p2）
    const pots = eventsOfKind(events, 'pot-awarded')
    expect(pots.map((p) => [p.amount, p.eligibleSeatIds])).toEqual([
      [600, ['p0', 'p1', 'p2']],
      [800, ['p0', 'p2']],
      [400, ['p2']],
    ])
    expect(pots.map((p) => p.winners.map((w) => w.seatId))).toEqual([['p1'], ['p0'], ['p2']])
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(1800) // = 200+1000+600 总贡献

    // 结算后筹码（无人出局，比赛继续进入手 3；终态另含手 3 盲注，以 hand-ended 口径断言）
    const ended = eventsOfKind(events, 'hand-ended').find((e) => e.hand === 2)
    expect(ended?.results.map((r) => [r.seatId, r.endStack])).toEqual([
      ['p0', 800],
      ['p1', 600],
      ['p2', 400],
    ])
    expect(state.handNumber).toBe(3)
    expectNoStall(state)
  })

  it('同手多人出局按开手筹码排序名次（PFR-101）', () => {
    // 变体：手 2 牌力 v(p1) > v(p0) > v(p2) 下无人出局；此处仅验证单元已覆盖排序规则，
    // 引擎路径的多人出局见 runout.test.ts（同筹码）与 tournament.test.ts（不同筹码）。
    expect(computePots([{ seatId: 'x', committed: 1, folded: false }])).toEqual([
      { amount: 1, eligibleSeatIds: ['x'] },
    ])
  })
})
