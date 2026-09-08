// AC-05 / PFR-202：平局分池与 TDA 奇数筹码——余数自按钮左侧第一个分池赢家起顺时针逐枚分配，结果唯一。

import { describe, expect, it } from 'vitest'
import { awardPots, computePots } from '@/games/poker/engine2'
import { act, eventsOfKind, evalValue, findSeed, mkConfig, newMatch, play } from './testkit'

describe('awardPots 奇数筹码单元（TDA 口径）', () => {
  it('101 筹码 3 人平分：每人 33，余 2 枚自按钮左侧第一个赢家起顺时针各得 1（PFR-202 验收例）', () => {
    // 座位自按钮左一顺时针：s1 → s2 → s3（按钮 s0）
    const awards = awardPots(
      [{ amount: 101, eligibleSeatIds: ['s1', 's2', 's3'] }],
      new Map([
        ['s1', 5],
        ['s2', 5],
        ['s3', 5],
      ]),
      ['s1', 's2', 's3', 's0'],
    )
    expect(awards[0].winners).toEqual([
      { seatId: 's1', baseShare: 33, oddChips: 1, total: 34 },
      { seatId: 's2', baseShare: 33, oddChips: 1, total: 34 },
      { seatId: 's3', baseShare: 33, oddChips: 0, total: 33 },
    ])
    expect(awards[0].winners.reduce((s, w) => s + w.total, 0)).toBe(101)
  })

  it('归属唯一确定：不依赖 eligible 数组顺序（PFR-202 验收）', () => {
    const a = awardPots(
      [{ amount: 101, eligibleSeatIds: ['s3', 's1', 's2'] }],
      new Map([
        ['s1', 5],
        ['s2', 5],
        ['s3', 5],
      ]),
      ['s1', 's2', 's3', 's0'],
    )
    const b = awardPots(
      [{ amount: 101, eligibleSeatIds: ['s2', 's3', 's1'] }],
      new Map([
        ['s1', 5],
        ['s2', 5],
        ['s3', 5],
      ]),
      ['s1', 's2', 's3', 's0'],
    )
    expect(a[0].winners.map((w) => [w.seatId, w.total])).toEqual(b[0].winners.map((w) => [w.seatId, w.total]))
    expect(a[0].winners[0]).toMatchObject({ seatId: 's1', total: 34 })
  })

  it('按钮左一变化时归属随座位顺时针序唯一变化', () => {
    // 按钮移到 s1：自 s2 起顺时针 s2 → s3 → s0
    const awards = awardPots(
      [{ amount: 101, eligibleSeatIds: ['s0', 's2', 's3'] }],
      new Map([
        ['s0', 5],
        ['s2', 5],
        ['s3', 5],
      ]),
      ['s2', 's3', 's0', 's1'],
    )
    expect(awards[0].winners.map((w) => [w.seatId, w.total])).toEqual([
      ['s2', 34],
      ['s3', 34],
      ['s0', 33],
    ])
  })

  it('单人资格池直接归其（不比牌、无奇数问题）', () => {
    const awards = awardPots([{ amount: 7, eligibleSeatIds: ['s1'] }], new Map(), ['s1', 's2'])
    expect(awards[0].winners).toEqual([{ seatId: 's1', baseShare: 7, oddChips: 0, total: 7 }])
  })

  it('多层嵌套时每池独立执行分割与奇数归属（PFR-202）', () => {
    const pots = computePots([
      { seatId: 'a', committed: 101, folded: false },
      { seatId: 'b', committed: 303, folded: false },
      { seatId: 'c', committed: 303, folded: false },
    ])
    const awards = awardPots(
      pots,
      new Map([
        ['a', 1],
        ['b', 2],
        ['c', 2],
      ]),
      ['a', 'b', 'c'],
    )
    // 主池 303：b/c 平分 → 151 each 余 1 归按钮左一第一个赢家 b；边池 404：202 each
    expect(awards.map((aw) => [aw.amount, aw.winners.map((w) => [w.seatId, w.total])])).toEqual([
      [303, [['b', 152], ['c', 151]]],
      [404, [['b', 202], ['c', 202]]],
    ])
  })
})

describe('AC-05 引擎集成（打板平分 + 死盲产生奇数余量）', () => {
  // 4 人 p0..p3（500），盲注 1/2，按钮 p0（SB=p1、BB=p2、UTG=p3）
  // p3 加注 10 / p0 跟 / p1 弃（死盲 1）/ p2 跟 → 三家打满四街全过牌
  // 牌面条件：p0/p2/p3 三家 7 张牌型价值完全相等（典型：三家都打板）
  // 分层：L1 = 1×4 = 4（3 家分：1×3 余 1 → 归按钮左一第一个赢家 p2）
  //      L2 = 9×3 = 27（3 家分：9 each）
  it('主池余 1 枚归按钮左一第一个分池赢家 p2；结果唯一且守恒', () => {
    const seed = findSeed({
      players: 4,
      button: 0,
      where: (l1) => evalValue(l1, 0) === evalValue(l1, 2) && evalValue(l1, 2) === evalValue(l1, 3),
    })
    const created = newMatch(mkConfig(['p0', 'p1', 'p2', 'p3'], 500, 1, 2), seed)
    expect(created.state.hand?.buttonSeat).toBe(0)
    expect(created.state.currentActor).toBe('p3')

    const s1 = act(created.state, 'p3', { type: 'raise', toAmount: 10 })
    const s2 = act(s1, 'p0', { type: 'call' })
    const s3 = act(s2, 'p1', { type: 'fold' })
    expect(s3.currentActor).toBe('p2')
    const s4 = act(s3, 'p2', { type: 'call' })
    expect(s4.hand?.street).toBe('flop')
    expect(s4.currentActor).toBe('p2') // postflop 按钮左一（p1 已弃 → p2）

    // 三街各 3 次 check（p2 → p3 → p0）
    const { state, events } = play(s4, [
      ['p2', { type: 'check' }],
      ['p3', { type: 'check' }],
      ['p0', { type: 'check' }],
      ['p2', { type: 'check' }],
      ['p3', { type: 'check' }],
      ['p0', { type: 'check' }],
      ['p2', { type: 'check' }],
      ['p3', { type: 'check' }],
      ['p0', { type: 'check' }],
    ])

    const reveals = eventsOfKind(events, 'cards-revealed')
    expect(reveals.map((r) => r.seatId)).toEqual(['p2', 'p3', 'p0']) // 无下注 → 按钮左一开始亮牌

    const pots = eventsOfKind(events, 'pot-awarded')
    expect(pots.map((p) => [p.amount, p.eligibleSeatIds])).toEqual([
      [4, ['p0', 'p2', 'p3']],
      [27, ['p0', 'p2', 'p3']],
    ])
    // 奇数 1 枚：按钮左一顺时针 p1(弃) → p2 先得
    expect(pots[0].winners.map((w) => [w.seatId, w.total])).toEqual([
      ['p2', 2],
      ['p3', 1],
      ['p0', 1],
    ])
    expect(pots[1].winners.map((w) => [w.seatId, w.total])).toEqual([
      ['p2', 9],
      ['p3', 9],
      ['p0', 9],
    ])

    // 筹码守恒（手 1 结算）：p0 = 500-10+1+9 = 500；p1 = 499；p2 = 500-10+2+9 = 501；p3 = 500
    // （终态 stacks 另含手 2 已扣盲注，故以 hand-ended 事件口径断言）
    const ended = eventsOfKind(events, 'hand-ended')[0]
    expect(ended.results.map((r) => [r.seatId, r.endStack])).toEqual([
      ['p0', 500],
      ['p1', 499],
      ['p2', 501],
      ['p3', 500],
    ])
    expect(state.handNumber).toBe(2)
  })
})
