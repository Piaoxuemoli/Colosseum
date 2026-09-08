// AC-08 / PFR-101、PFR-105：淘汰定名次、单人存活自然终局、受控结束（当前手后终止 / 立即终止）。

import { describe, expect, it } from 'vitest'
import {
  applyAction,
  classifyState,
  evaluateBest,
  requestStopAfterCurrentHand,
  terminateImmediately,
} from '@/games/poker/engine2'
import type { Card, MatchState, PokerEvent } from '@/games/poker/engine2'
import { driver, eventsOfKind, expectNoStall, findSeed, mkConfig, play } from './testkit'

type Layout = { holeCards: Card[][]; board: Card[] }

function evalV(layout: Layout, position: number): number {
  const hole = layout.holeCards[position]
  if (!hole) throw new Error(`evalV: 位置 ${position} 不存在`)
  return evaluateBest([...hole, ...layout.board]).value
}

describe('AC-08 淘汰与单人终局', () => {
  it('筹码归零即出局并当场定名次；单人存活时自然终局并产出完整排名', () => {
    // 3 人各 100，手 1 三家全下：p0 最强 → p1、p2 归零出局（名次 3/2），p0 夺冠
    const seed = findSeed({
      players: 3,
      button: 0,
      where: (l1) => evalV(l1, 0) > evalV(l1, 1) && evalV(l1, 0) > evalV(l1, 2),
    })
    const d = driver(mkConfig(['p0', 'p1', 'p2'], 100, 1, 2), seed)
    d.step('p0', { type: 'all-in' })
    d.step('p1', { type: 'all-in' })
    d.step('p2', { type: 'all-in' })

    const elims = eventsOfKind(d.events, 'player-eliminated')
    expect(elims.map((e) => [e.seatId, e.rank])).toEqual([
      ['p1', 3],
      ['p2', 2],
    ])

    const finished = eventsOfKind(d.events, 'match-finished')
    expect(finished).toHaveLength(1)
    expect(finished[0].reason).toBe('natural')
    expect(finished[0].terminatedAt).toBeNull()
    expect(finished[0].ranking).toEqual([
      { seatId: 'p0', rank: 1, chips: 300 },
      { seatId: 'p2', rank: 2, chips: 0 },
      { seatId: 'p1', rank: 3, chips: 0 },
    ])
    // 排名可由事件流回推验证：出局逆序（PFR-101：对齐 FR-4.6-01）
    const exitOrder = elims.map((e) => e.seatId)
    expect(finished[0].ranking.slice(1).map((r) => r.seatId)).toEqual([...exitOrder].reverse())
    expect(classifyState(d.state).kind).toBe('finished')
    expectNoStall(d.state)
  })

  it('逐手淘汰：不同手出局名次按出局顺序逆推；淘汰者按钮位被跳过（简化移位）', () => {
    // 手 1：p0 淘汰 p1（p2 弃牌）；手 2（p0/p2 存活，发牌位 0=p0、1=p2）：p0 淘汰 p2
    const seed = findSeed({
      players: 3,
      button: 0,
      where: (l1, at) => evalV(l1, 0) > evalV(l1, 1) && evalV(at(2, 2), 0) > evalV(at(2, 2), 1),
    })
    const d = driver(mkConfig(['p0', 'p1', 'p2'], 100, 1, 2), seed)
    // 手 1：p0 全下 100，p1 全下跟注，p2 弃牌 → p1 出局（rank 3），p0 获 202
    d.step('p0', { type: 'all-in' })
    d.step('p1', { type: 'all-in' })
    d.step('p2', { type: 'fold' })
    expect(d.state.handNumber).toBe(2)
    expect(d.state.players.find((p) => p.seatId === 'p1')?.status).toBe('eliminated')
    expect(d.state.players.find((p) => p.seatId === 'p1')?.rank).toBe(3)
    // p2 仅失去盲注 2（手 2 已开始：p2=按钮/SB 又 post 1 → 97）
    expect(d.state.players.find((p) => p.seatId === 'p2')?.stack).toBe(97)

    // 手 2：heads-up（p2 按钮=SB，p0=BB）；p2 全下 98，p0 全下跟注（未跟注部分退还）→ p2 出局
    expect(d.state.currentActor).toBe('p2')
    d.step('p2', { type: 'all-in' })
    d.step('p0', { type: 'all-in' })

    const finished = eventsOfKind(d.events, 'match-finished')
    expect(finished).toHaveLength(1)
    expect(finished[0].reason).toBe('natural')
    expect(finished[0].ranking).toEqual([
      { seatId: 'p0', rank: 1, chips: 300 },
      { seatId: 'p2', rank: 2, chips: 0 },
      { seatId: 'p1', rank: 3, chips: 0 },
    ])
    expect(d.state.players.find((p) => p.seatId === 'p0')?.stack).toBe(300)

    // 终局后任何动作被拒（MATCH_ALREADY_FINISHED）
    const r = applyAction(d.state, 'p0', { type: 'fold' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejection.code).toBe('MATCH_ALREADY_FINISHED')
  })
})

describe('AC-08 受控结束（PFR-105）', () => {
  function midHand(): { state: MatchState; events: PokerEvent[] } {
    // 3 人 500，盲注 1/2，按钮 p0：p0 加注 10、p1 跟注，停在 p2（BB）行动前
    const seed = findSeed({ players: 3, button: 0, where: () => true })
    const d = driver(mkConfig(['p0', 'p1', 'p2'], 500, 1, 2), seed)
    d.step('p0', { type: 'raise', toAmount: 10 })
    d.step('p1', { type: 'call' })
    return { state: d.state, events: d.events }
  }

  it('指令 a（当前手结束后终止）：当前手完成结算后终局，含人为终止标注与时点', () => {
    const { state } = midHand()
    const stopped = requestStopAfterCurrentHand(state)
    expect(stopped.ok).toBe(true)
    if (!stopped.ok) return
    expect(eventsOfKind(stopped.events, 'stop-requested')).toHaveLength(1)

    // p2 跟注后逐街过牌打完当前手 → 结算 → 不开新手直接终局
    const after = play(stopped.state, [['p2', { type: 'call' }]])
    let s = after.state
    const events: PokerEvent[] = [...after.events]
    let guard = 0
    while (s.phase === 'awaiting-action' && guard < 20) {
      const r = applyAction(s, s.currentActor as string, { type: 'check' })
      if (!r.ok) throw new Error(r.rejection.message)
      s = r.state
      events.push(...r.events)
      guard += 1
    }
    expect(s.phase).toBe('finished')

    const finished = eventsOfKind(events, 'match-finished')
    expect(finished).toHaveLength(1)
    expect(finished[0].reason).toBe('controlled-after-hand')
    expect(finished[0].terminatedAt).not.toBeNull()
    expect(finished[0].terminatedAt?.hand).toBe(1)
    // 当前手结算完整保留：分池授予与手牌摘要均在终局事件之前
    const summary = eventsOfKind(events, 'hand-ended')
    expect(summary).toHaveLength(1)
    expect(summary[0].seq).toBeLessThan(finished[0].seq)
    // 终局后无任何新手开始事件
    expect(eventsOfKind(events, 'hand-started')).toHaveLength(0)
    expectNoStall(s)
  })

  it('指令 b（立即终止）：按当前有效筹码结算排名、标注人为终止与时点', () => {
    const { state, events } = midHand()
    const before = events.length
    const r = terminateImmediately(state)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(events).toHaveLength(before) // 此前事件完整保留（未被触碰）
    expect(r.events).toHaveLength(1) // 仅追加终局事件

    const finished = eventsOfKind(r.events, 'match-finished')
    expect(finished).toHaveLength(1)
    expect(finished[0].reason).toBe('controlled-immediate')
    expect(finished[0].terminatedAt).toEqual({ seq: finished[0].seq, hand: 1 })
    // 排名按当前有效筹码（桌面 + 本手已投入）：三家均回到 500
    expect(finished[0].ranking.map((x) => [x.seatId, x.chips])).toEqual([
      ['p0', 500],
      ['p1', 500],
      ['p2', 500],
    ])
    expect(r.state.phase).toBe('finished')
    expectNoStall(r.state)
  })
})
