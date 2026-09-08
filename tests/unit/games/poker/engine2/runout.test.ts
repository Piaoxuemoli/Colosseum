// AC-01 / PFR-210：全员全下自动 run-out——逐街发牌、全员亮牌、分池结算、比赛正常进入下一手。
// 牌面构造用"牌型价值排序"谓词搜索种子（p0 > p1 > p2）。

import { describe, expect, it } from 'vitest'
import { classifyState } from '@/games/poker/engine2'
import { cardOf, eventsOfKind, expectNoStall, findSeed, layoutFor, mkConfig, newMatch, play, valueOrder } from './testkit'

describe('AC-01 run-out', () => {
  it('3 人 preflop 全下：自动逐街发完（各独立事件）→ 全员亮牌 → 分池结算 → 淘汰与终局', () => {
    const seed = findSeed({
      players: 3,
      button: 0,
      where: (l1) => valueOrder(l1, [0, 1, 2]), // p0 最强 > p1 > p2
    })
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 100, 1, 2), seed)
    expect(created.state.hand?.buttonSeat).toBe(0)
    const { state, events } = play(created.state, [
      ['p0', { type: 'all-in' }], // 按钮（3 人局 UTG）全下 100
      ['p1', { type: 'all-in' }], // SB 全下至 100（已 post 1）
      ['p2', { type: 'all-in' }], // BB 全下至 100（已 post 2）
    ])

    // run-out 事件序列（AC-01：每街独立事件）
    expect(eventsOfKind(events, 'run-out-started')).toHaveLength(1)
    const streets = eventsOfKind(events, 'street-dealt')
    expect(streets.map((s) => [s.street, s.auto, s.cards.length])).toEqual([
      ['flop', true, 3],
      ['turn', true, 1],
      ['river', true, 1],
    ])
    // 发牌内容与种子推导的牌序一致（PFR-404 可复现）
    const layout = layoutFor(seed, 3, 1)
    const boardCodes = [...layout.board.slice(0, 3), ...layout.board.slice(3)].map(cardOf)
    expect(streets.flatMap((s) => s.cards.map(cardOf))).toEqual(boardCodes)

    // 全员亮牌（PFR-210：所有在池玩家必须亮牌）
    const reveals = eventsOfKind(events, 'cards-revealed')
    expect(reveals.map((r) => [r.seatId, r.cards.map(cardOf).join()])).toEqual(
      layout.holeCards.map((h, i) => [`p${i}`, h.map(cardOf).join()]),
    )

    // 单层 300 全额发放给最强者 p0
    const pots = eventsOfKind(events, 'pot-awarded')
    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(300)
    expect(pots[0].winners.map((w) => w.seatId)).toEqual(['p0'])

    // 淘汰与名次（同手出局：同起始筹码 → 按钮顺时针近者名次更差）
    expect(eventsOfKind(events, 'player-eliminated').map((e) => [e.seatId, e.rank])).toEqual([
      ['p1', 3],
      ['p2', 2],
    ])
    const finished = eventsOfKind(events, 'match-finished')
    expect(finished).toHaveLength(1)
    expect(finished[0].reason).toBe('natural')
    expect(finished[0].ranking).toEqual([
      { seatId: 'p0', rank: 1, chips: 300 },
      { seatId: 'p2', rank: 2, chips: 0 },
      { seatId: 'p1', rank: 3, chips: 0 },
    ])
    expect(classifyState(state).kind).toBe('finished')
    expectNoStall(state)
  })

  it('第三方弃牌后两人全下 run-out：死盲入池、比赛继续进入下一手（不中断、不提前终局）', () => {
    const seed = findSeed({ players: 3, button: 0, where: (l1) => valueOrder(l1, [0, 1, 2]) })
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 100, 1, 2), seed)
    const { state, events } = play(created.state, [
      ['p0', { type: 'all-in' }],
      ['p1', { type: 'all-in' }],
      ['p2', { type: 'fold' }], // BB 弃牌：死盲 2 留在池中
    ])
    expect(eventsOfKind(events, 'street-dealt').map((s) => s.street)).toEqual(['flop', 'turn', 'river'])
    expect(eventsOfKind(events, 'cards-revealed').map((r) => r.seatId).sort()).toEqual(['p0', 'p1'])

    // 分层：L1 = 2×3 = 6（死盲含入，弃牌者无资格），L2 = 98×2 = 196；两层均归 p0
    const pots = eventsOfKind(events, 'pot-awarded')
    expect(pots.map((p) => [p.amount, p.eligibleSeatIds])).toEqual([
      [6, ['p0', 'p1']],
      [196, ['p0', 'p1']],
    ])
    expect(pots.map((p) => p.winners.map((w) => w.seatId))).toEqual([['p0'], ['p0']])

    // p2 仅失去盲注 2，存活 → 下一手开始
    expect(state.phase).toBe('awaiting-action')
    expect(state.handNumber).toBe(2)
    expect(eventsOfKind(events, 'hand-started').map((h) => h.handNumber)).toEqual([2])
    expectNoStall(state)
  })

  it('heads-up 一方 all-in 被跟注：同样触发自动 run-out（PFR-210 验收例）', () => {
    const seed = findSeed({ players: 2, button: 0, where: (l1) => valueOrder(l1, [0, 1]) })
    const created = newMatch(mkConfig(['p0', 'p1'], 200, 2, 4), seed)
    expect(created.state.hand?.sbSeat).toBe(created.state.hand?.buttonSeat)
    const { state, events } = play(created.state, [
      ['p0', { type: 'all-in' }],
      ['p1', { type: 'all-in' }],
    ])
    expect(eventsOfKind(events, 'run-out-started')).toHaveLength(1)
    expect(eventsOfKind(events, 'cards-revealed')).toHaveLength(2)
    const pots = eventsOfKind(events, 'pot-awarded')
    expect(pots.reduce((sum, p) => sum + p.amount, 0)).toBe(400)
    expect(classifyState(state).kind).toBe('finished')
  })
})
