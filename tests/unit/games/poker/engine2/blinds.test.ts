// AC-06 / PFR-211：短盲全下——引擎代提交、事件留痕、位置权利保留。
// AC-07 / PFR-212：盲注升级——升级事件先于手牌开始事件、新手按新级执行、短码按短盲规则继续。

import { describe, expect, it } from 'vitest'
import { applyAction } from '@/games/poker/engine2'
import type { PokerEvent } from '@/games/poker/engine2'
import { driver, eventsOfKind, expectNoStall, findSeed, mkConfig, newMatch } from './testkit'

function seedButton0(players: number): number {
  return findSeed({ players, button: 0, where: () => true })
}

describe('AC-06 短盲全下', () => {
  it('SB 筹码 1 应缴 2：引擎代提交 1 并处于全下，事件留痕（PFR-211 验收例）', () => {
    // heads-up 起始 1，盲注 2/4：按钮/SB post 1 全下、BB post 1 全下 → 开局即 run-out
    const seed = findSeed({ players: 2, button: 0, where: () => true })
    const created = newMatch(mkConfig(['p0', 'p1'], 1, 2, 4), seed)
    const handEvents = created.events.filter((e) => e.hand === 1)
    const blinds = eventsOfKind(handEvents, 'blinds-posted')
    expect(blinds).toHaveLength(1)
    expect(blinds[0].posts.map((p) => [p.seatId, p.blind, p.due, p.posted, p.allIn])).toEqual([
      ['p0', 'sb', 2, 1, true],
      ['p1', 'bb', 4, 1, true],
    ])
    // 全员盲注全下 → 发牌即 run-out（createMatch 内一次完成），无等待状态
    expect(eventsOfKind(handEvents, 'run-out-started')).toHaveLength(1)
    expect(eventsOfKind(handEvents, 'street-dealt')).toHaveLength(3)
    expectNoStall(created.state)
  })

  it('BB 短盲全下且无人加注：无需 BB 再行动，直接进入 run-out（PFR-211 验收例）', () => {
    // 3 人起始 3，盲注 2/6：p1=SB post 2 余 1；p2=BB post 3 全下（短盲）
    const seed = seedButton0(3)
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 3, 2, 6), seed)
    expect(created.state.hand?.buttonSeat).toBe(0)
    const blinds = eventsOfKind(created.events, 'blinds-posted')[0]
    expect(blinds.posts.map((p) => [p.seatId, p.blind, p.due, p.posted, p.allIn])).toEqual([
      ['p1', 'sb', 2, 2, false],
      ['p2', 'bb', 6, 3, true],
    ])
    const bb = created.state.players.find((p) => p.seatId === 'p2')
    expect(bb?.status).toBe('all-in')
    expect(bb?.totalCommitted).toBe(3) // 盲注计入本手累计贡献（PFR-211）

    // p0(按钮/UTG) 短跟 3 全下、p1(SB) 补 1 全下 → 三人全下 run-out，BB 全程无需行动
    const { state, events } = (() => {
      let s = created.state
      const ev: PokerEvent[] = []
      for (const step of [['p0', { type: 'call' }], ['p1', { type: 'call' }]] as const) {
        const r = applyAction(s, step[0], step[1])
        if (!r.ok) throw new Error(r.rejection.message)
        s = r.state
        ev.push(...r.events)
      }
      return { state: s, events: ev }
    })()
    expect(eventsOfKind(events, 'run-out-started')).toHaveLength(1)
    expect(eventsOfKind(events, 'cards-revealed')).toHaveLength(3)
    expect(events.filter((e) => e.kind === 'action-made' && e.seatId === 'p2')).toHaveLength(0)
    expectNoStall(state)
  })

  it('盲注已提交即计入累计贡献，参与边池分层（PFR-211 验收例）', () => {
    const seed = seedButton0(3)
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 100, 5, 10), seed)
    const sb = created.state.players.find((p) => p.seatId === 'p1')
    const bb = created.state.players.find((p) => p.seatId === 'p2')
    expect(sb?.streetBet).toBe(5)
    expect(sb?.totalCommitted).toBe(5)
    expect(bb?.streetBet).toBe(10)
    expect(bb?.totalCommitted).toBe(10)
  })
})

describe('AC-07 盲注升级（手数制，PFR-212）', () => {
  const schedule = {
    handsPerLevel: 2,
    levels: [
      { sb: 1, bb: 2 },
      { sb: 2, bb: 4 },
      { sb: 10, bb: 20 },
    ],
  }

  /** 让当前行动者连续弃牌直至本手结束（快局）。 */
  function foldHandTo(d: ReturnType<typeof driver>, untilHandNumber: number): void {
    let guard = 0
    while (d.state.handNumber < untilHandNumber && d.state.currentActor !== null && guard < 8) {
      d.step(d.state.currentActor, { type: 'fold' })
      guard += 1
    }
  }

  it('每 2 手升级：第 3 手起 2/4；升级事件先于该手开始事件；短码按短盲规则继续', () => {
    const d = driver(mkConfig(['p0', 'p1'], 20, 1, 2, schedule), 3)
    expect(d.state.blinds).toEqual({ sb: 1, bb: 2 })
    expect(d.state.handNumber).toBe(1)

    // 打完手 1、手 2（仍为 1/2），进入手 3 时升级到 2/4
    foldHandTo(d, 2)
    expect(d.state.handNumber).toBe(2)
    expect(d.state.blinds).toEqual({ sb: 1, bb: 2 })
    foldHandTo(d, 3)
    expect(d.state.handNumber).toBe(3)
    expect(d.state.blinds).toEqual({ sb: 2, bb: 4 })

    // 事件顺序：升级事件位于手 3 开始事件之前（PFR-212 验收例）
    const raised = eventsOfKind(d.events, 'blind-level-raised').filter((e) => e.level === 1)
    expect(raised).toHaveLength(1)
    expect(raised[0].hand).toBe(3)
    const hand3Start = eventsOfKind(d.events, 'hand-started').find((h) => h.handNumber === 3)
    expect(hand3Start).toBeDefined()
    expect(raised[0].seq).toBeLessThan(hand3Start?.seq ?? Infinity)
    expect(hand3Start?.blinds).toEqual({ sb: 2, bb: 4 })

    // 打到第 5 手升级 10/20：起始 20 的玩家 BB 需 20 → 恰好全下（非短），SB 需 10 → 正常；
    // 让 p? 短码：弃牌快局会转移筹码。此处校验第 5 手盲注级生效且手照常进行
    foldHandTo(d, 5)
    expect(d.state.handNumber).toBe(5)
    expect(d.state.blinds).toEqual({ sb: 10, bb: 20 })
    const raised2 = eventsOfKind(d.events, 'blind-level-raised').filter((e) => e.level === 2)
    expect(raised2).toHaveLength(1)
    expect(raised2[0].hand).toBe(5)
    const hand5Start = eventsOfKind(d.events, 'hand-started').find((h) => h.handNumber === 5)
    expect(raised2[0].seq).toBeLessThan(hand5Start?.seq ?? Infinity)
    expectNoStall(d.state)
  })

  it('短码玩家在新盲注级下按短盲规则继续（筹码 < SB 时全下代提交）', () => {
    // heads-up 起始 30，schedule 每 1 手升级，第 3 级 25/50 → BB 筹码不足 50 时短盲全下
    const scheduleEveryHand = {
      handsPerLevel: 1,
      levels: [
        { sb: 1, bb: 2 },
        { sb: 2, bb: 4 },
        { sb: 25, bb: 50 },
      ],
    }
    const d = driver(mkConfig(['p0', 'p1'], 30, 1, 2, scheduleEveryHand), 5)
    // 手 1、手 2：各一次弃牌快局（输小盲 1 与 2），手 3 进入 25/50
    foldHandTo(d, 3)
    expect(d.state.blinds).toEqual({ sb: 25, bb: 50 })
    const blinds3 = eventsOfKind(d.events, 'blinds-posted').filter((e) => e.hand === 3)[0]
    // 两家筹码 ≈ 28/29：SB（≥25）足额缴 25 非全下；BB（<50）按剩余全下
    expect(blinds3.posts.map((p) => [p.blind, p.due])).toEqual([
      ['sb', 25],
      ['bb', 50],
    ])
    expect(blinds3.posts[0].posted).toBe(25)
    expect(blinds3.posts[0].allIn).toBe(false)
    expect(blinds3.posts[1].posted).toBeLessThan(50)
    expect(blinds3.posts[1].posted).toBeGreaterThan(0)
    expect(blinds3.posts[1].allIn).toBe(true)
    expectNoStall(d.state)
  })

  it('升级间隔内（第 4 手）盲注保持 2/4 不变', () => {
    const d = driver(mkConfig(['p0', 'p1'], 500, 1, 2, schedule), 3)
    foldHandTo(d, 4)
    expect(d.state.handNumber).toBe(4)
    expect(d.state.blinds).toEqual({ sb: 2, bb: 4 })
    expect(eventsOfKind(d.events, 'blind-level-raised')).toHaveLength(1)
  })
})
