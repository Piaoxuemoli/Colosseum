// AC-10 / PFR-207、PFR-503：非法动作结构化拒绝——原因可区分、附合法区间、状态与事件零变化。

import { describe, expect, it } from 'vitest'
import { applyAction, requestStopAfterCurrentHand } from '@/games/poker/engine2'
import type { RejectionCode } from '@/games/poker/engine2'
import { eventsOfKind, expectNoStall, findSeed, mkConfig, newMatch, play } from './testkit'

function freshMatch() {
  const seed = findSeed({ players: 3, button: 0, where: () => true })
  const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 300, 1, 2), seed)
  expect(created.state.currentActor).toBe('p0') // 3 人局 UTG = 按钮
  return created.state
}

describe('AC-10 非法动作结构化拒绝', () => {
  it('超筹码 bet → AMOUNT_ABOVE_MAX，不自动折算为全下（PFR-207 验收例；postflop 无注局面）', () => {
    const s = freshMatch()
    // 进入 flop（无注局面）后声明 bet 500（剩余 300）
    const flop = play(s, [
      ['p0', { type: 'call' }],
      ['p1', { type: 'call' }],
      ['p2', { type: 'check' }],
    ]).state
    expect(flop.hand?.street).toBe('flop')
    expect(flop.currentActor).toBe('p1')
    const r = applyAction(flop, 'p1', { type: 'bet', amount: 500 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.rejection.code).toBe('AMOUNT_ABOVE_MAX')
    expect(r.rejection.maxTo).toBe(298) // p1 已 post 1 + 补平 1 → 298
    expect(r.state).toBe(flop) // 状态引用不变
    expect(r.state.players[1].stack).toBe(298) // 不自动折算为全下
    // preflop 超筹码加注同理
    const r2 = applyAction(s, 'p0', { type: 'raise', toAmount: 500 })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.rejection.code).toBe('AMOUNT_ABOVE_MAX')
  })

  it('低于最小加注且非全下 → BELOW_MIN_RAISE_NOT_ALL_IN，附合法区间', () => {
    const s = freshMatch()
    const s1 = play(s, [['p0', { type: 'raise', toAmount: 8 }]]).state
    const r = applyAction(s1, 'p1', { type: 'raise', toAmount: 10 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.rejection.code).toBe('BELOW_MIN_RAISE_NOT_ALL_IN')
    expect(r.rejection.minTo).toBe(14)
    expect(r.rejection.maxTo).toBe(300) // p1 streetBet 1 + stack 299
  })

  it('非行动者动作 → NOT_CURRENT_ACTOR', () => {
    const s = freshMatch()
    const r = applyAction(s, 'p2', { type: 'call' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.rejection.code).toBe('NOT_CURRENT_ACTOR')
    expect(r.rejection.currentActor).toBe('p0')
  })

  it('面临下注时 check / 无注可跟时 call → ACTION_TYPE_UNAVAILABLE', () => {
    const s = freshMatch()
    const r1 = applyAction(s, 'p0', { type: 'check' }) // UTG 面临 BB
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.rejection.code).toBe('ACTION_TYPE_UNAVAILABLE')

    const s1 = play(s, [['p0', { type: 'call' }]]).state
    // p1(SB) 仍面临 2，check 非法；call 后到 BB option 时 call 才非法
    const r2 = applyAction(s1, 'p1', { type: 'check' })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.rejection.code).toBe('ACTION_TYPE_UNAVAILABLE')

    const s2 = play(s1, [['p1', { type: 'call' }]]).state
    const r3 = applyAction(s2, 'p2', { type: 'call' }) // BB option：toCall = 0
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect(r3.rejection.code).toBe('ACTION_TYPE_UNAVAILABLE')
  })

  it('非法金额结构（非正整数）→ INVALID_AMOUNT', () => {
    const s = freshMatch()
    for (const bad of [{ type: 'bet', amount: 10.5 }, { type: 'bet', amount: -3 }, { type: 'raise', toAmount: 0 }]) {
      const r = applyAction(s, 'p0', bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.rejection.code).toBe('INVALID_AMOUNT')
    }
  })

  it('各类拒绝原因编码可区分（机器可读）', () => {
    const s = freshMatch()
    const flop = play(s, [
      ['p0', { type: 'call' }],
      ['p1', { type: 'call' }],
      ['p2', { type: 'check' }],
    ]).state
    const codes: RejectionCode[] = []
    const r1 = applyAction(s, 'p2', { type: 'call' }) // 非行动者
    if (!r1.ok) codes.push(r1.rejection.code)
    const r2 = applyAction(flop, 'p1', { type: 'bet', amount: 999 }) // 超筹码
    if (!r2.ok) codes.push(r2.rejection.code)
    const r3 = applyAction(s, 'p0', { type: 'check' }) // 面临盲注不能 check
    if (!r3.ok) codes.push(r3.rejection.code)
    const r4 = applyAction(flop, 'p1', { type: 'bet', amount: 1 }) // 低于最小注且非全下
    if (!r4.ok) codes.push(r4.rejection.code)
    const r5 = applyAction(s, 'p0', { type: 'raise', toAmount: 3 }) // 低于最小加注（4）且非全下
    if (!r5.ok) codes.push(r5.rejection.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toEqual(
      expect.arrayContaining([
        'NOT_CURRENT_ACTOR',
        'AMOUNT_ABOVE_MAX',
        'ACTION_TYPE_UNAVAILABLE',
        'AMOUNT_BELOW_MIN',
        'BELOW_MIN_RAISE_NOT_ALL_IN',
      ]),
    )
  })

  it('拒绝零副作用：状态不变、事件流零增长，且不影响后续合法推进（PFR-503）', () => {
    const s = freshMatch()
    const snapshot = JSON.stringify(s)
    const r = applyAction(s, 'p0', { type: 'bet', amount: 500 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.state).toBe(s)
      expect('events' in r).toBe(false) // 拒绝分支不携带事件，事件流零变化
    }
    expect(JSON.stringify(s)).toBe(snapshot)

    // 合法动作仍正常推进
    const ok = play(s, [['p0', { type: 'raise', toAmount: 6 }], ['p1', { type: 'fold' }], ['p2', { type: 'fold' }]])
    // p0 赢盲注，手 2 开始
    expect(ok.state.handNumber).toBe(2)
    expectNoStall(ok.state)
  })

  it('终局后提交动作 → MATCH_ALREADY_FINISHED（与 NOT_CURRENT_ACTOR 区分）', () => {
    // 打到自然终局
    const seed = findSeed({ players: 2, button: 0, where: () => true })
    const created = newMatch(mkConfig(['p0', 'p1'], 1, 2, 4), seed)
    // 起始 1、盲注 2/4 → 双方盲注全下 run-out → 终局
    expect(created.state.phase).toBe('finished')
    const r = applyAction(created.state, 'p0', { type: 'fold' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.code).toBe('MATCH_ALREADY_FINISHED')

    const stop = requestStopAfterCurrentHand(created.state)
    expect(stop.ok).toBe(false)
    if (!stop.ok) expect(stop.rejection.code).toBe('MATCH_ALREADY_FINISHED')
  })

  it('终局事件之后事件流保持完整（含全部已发生事件）', () => {
    const seed = findSeed({ players: 2, button: 0, where: () => true })
    const created = newMatch(mkConfig(['p0', 'p1'], 1, 2, 4), seed)
    expect(eventsOfKind(created.events, 'match-finished')).toHaveLength(1)
    expect(created.events.length).toBeGreaterThan(5)
  })
})
