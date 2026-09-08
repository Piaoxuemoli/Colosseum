// AC-04 / PFR-204：heads-up 特殊顺序——按钮 = SB；preflop 按钮先行动；postflop BB 先行动；按钮逐手轮转。

import { describe, expect, it } from 'vitest'
import { classifyState } from '@/games/poker/engine2'
import { eventsOfKind, expectNoStall, mkConfig, newMatch, play } from './testkit'

const ANY = 11 // heads-up 的顺序与牌面无关，任意种子即可（确定性重放见 replay.test.ts）

describe('AC-04 heads-up 顺序', () => {
  it('按钮位 = SB；preflop 按钮先行动', () => {
    const created = newMatch(mkConfig(['p0', 'p1'], 500, 5, 10), ANY)
    const h = created.state.hand
    expect(h).not.toBeNull()
    expect(h?.sbSeat).toBe(h?.buttonSeat)
    expect(created.state.currentActor).toBe(created.state.players[h?.buttonSeat ?? 0].seatId)
  })

  it('postflop BB（非按钮）先行动', () => {
    const created = newMatch(mkConfig(['p0', 'p1'], 500, 5, 10), ANY)
    const buttonSeat = created.state.hand?.buttonSeat ?? 0
    const bbSeat = buttonSeat === 0 ? 1 : 0
    const { state } = play(created.state, [
      ['p' + buttonSeat, { type: 'call' }], // SB 补 5
      ['p' + bbSeat, { type: 'check' }], // BB option
    ])
    expect(state.hand?.street).toBe('flop')
    expect(state.currentActor).toBe('p' + bbSeat)
  })

  it('多手间按钮正确轮转（简化移位：下一存活座位）', () => {
    const created = newMatch(mkConfig(['p0', 'p1'], 500, 5, 10), ANY)
    const first = created.state.hand?.buttonSeat ?? 0
    // 手 1：SB 弃牌，BB 直接赢盲注
    const s1 = play(created.state, [['p' + first, { type: 'fold' }]]).state
    expect(s1.handNumber).toBe(2)
    expect(s1.hand?.buttonSeat).toBe(first === 0 ? 1 : 0)
    // 手 2：新按钮（=SB）同样先行动
    expect(s1.currentActor).toBe('p' + (first === 0 ? 1 : 0))
    expectNoStall(s1)
  })

  it('双方过牌到底：强制摊牌全员亮牌，无下注时自按钮左一（=BB）开始亮牌（PFR-209）', () => {
    const created = newMatch(mkConfig(['p0', 'p1'], 500, 5, 10), ANY)
    const buttonSeat = created.state.hand?.buttonSeat ?? 0
    const bb = buttonSeat === 0 ? 'p1' : 'p0'
    const btn = 'p' + buttonSeat
    const { state, events } = play(created.state, [
      [btn, { type: 'call' }],
      [bb, { type: 'check' }],
      [bb, { type: 'check' }],
      [btn, { type: 'check' }],
      [bb, { type: 'check' }],
      [btn, { type: 'check' }],
      [bb, { type: 'check' }],
      [btn, { type: 'check' }],
    ])
    const reveals = eventsOfKind(events, 'cards-revealed')
    expect(reveals).toHaveLength(2)
    expect(reveals[0].seatId).toBe(bb) // river 无下注 → 按钮左一（BB）先亮
    expect(reveals[1].seatId).toBe(btn)
    // 结算完成（一手结束摘要存在），比赛未终局
    expect(eventsOfKind(events, 'hand-ended')).toHaveLength(1)
    expect(classifyState(state).kind).toBe('awaiting-action')
    expect(state.handNumber).toBe(2)
  })

  it('按钮位下注被跟注：river 有下注时最后进攻者先亮牌（PFR-209）', () => {
    const created = newMatch(mkConfig(['p0', 'p1'], 500, 5, 10), ANY)
    const buttonSeat = created.state.hand?.buttonSeat ?? 0
    const bb = buttonSeat === 0 ? 'p1' : 'p0'
    const btn = 'p' + buttonSeat
    const { events } = play(created.state, [
      [btn, { type: 'call' }],
      [bb, { type: 'check' }],
      [bb, { type: 'check' }],
      [btn, { type: 'check' }],
      [bb, { type: 'check' }],
      [btn, { type: 'check' }],
      [bb, { type: 'check' }],
      [btn, { type: 'bet', amount: 20 }], // river 按钮下注
      [bb, { type: 'call' }],
    ])
    const reveals = eventsOfKind(events, 'cards-revealed')
    expect(reveals).toHaveLength(2)
    expect(reveals[0].seatId).toBe(btn) // 最后进攻者（按钮）先亮
    expect(reveals[1].seatId).toBe(bb)
  })
})
